/**
 * 字级 diff：**审阅要读的是「改了哪儿」，不是「有两个版本」**。
 *
 * 原来的 `changeSummary` 只剥公共前后缀，算出 `+N / −N` 两个数字。数字能写进一行标题，
 * 但**画不出来**——一段 800 字的改写，中间换了三处措辞，剥完前后缀剩下的仍然是 700 字
 * 「全删全增」。人在正文里看到的就是整段划掉再整段新增，等于没有 diff。
 *
 * 这里做真的 token 级 LCS。三条设计决定：
 *
 * 1. **中文按单字切，西文按词切。** 中文没有词边界，按「词」切要么引入分词器（一个几百 KB
 *    的依赖，为了画底色不值），要么按标点切成大块（又回到整段全删全增）。单字粒度在中文里
 *    正好——改一个「的」就只有那个「的」变色。
 * 2. **标点和空白各自成 token**，不粘在字上：「结论，」→「结论时，」只该动一个字。
 * 3. **有成本闸。** LCS 是 O(n·m) 的表。全文候选（一两万字）会直接把内存吃掉，
 *    所以剩余 token 乘积超阈值时退回「整段替换」——那种规模下逐字上色本来也读不出信息。
 */

/**
 * 超过这个规模不做字级 diff。
 *
 * 实测（Node 24，`Int32Array` 表）：500×500 = 4ms/1MB，1000×1000 = 8ms/4MB，
 * **2000×2000 = 33ms/15MB**，4000×4000 = 127ms/61MB。400 万格是那条「还能在一帧里
 * 算完、内存还不吓人」的线，对应剥掉公共前后缀之后**两边各两千字**——段落和章节级修订
 * 全在线内，只有整篇重写会退化，而整篇重写本来就没有可对齐的东西。
 */
export const DIFF_BUDGET = 4_000_000;

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;
const WORD = /[0-9A-Za-z_'\u00C0-\u024F]/;

/**
 * 切 token。CJK 一字一个，拉丁词和数字连成一个，其余（标点、空白、emoji）一字一个。
 *
 * 拼接回去必须**一个字节不差**等于原串——diff 的位置要拿去在 CodeMirror 上画装饰，
 * 差一个字符就整段错位。
 */
export function tokenize(text) {
  const source = String(text ?? "");
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (WORD.test(char) && !CJK.test(char)) {
      let end = index + 1;
      while (end < source.length && WORD.test(source[end]) && !CJK.test(source[end])) end += 1;
      tokens.push(source.slice(index, end));
      index = end;
      continue;
    }
    // 代理对（emoji）要整个拿走，拆开就是两个乱码
    const size = char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdbff && index + 1 < source.length ? 2 : 1;
    tokens.push(source.slice(index, index + size));
    index += size;
  }
  return tokens;
}

/** 相邻同类合并成一段，让装饰的区间数尽量少。 */
function merge(parts) {
  const out = [];
  for (const part of parts) {
    if (!part.text) continue;
    const last = out.at(-1);
    if (last && last.type === part.type) last.text += part.text;
    else out.push({ ...part });
  }
  return out;
}

/** 经典 LCS 回溯表。只在剥掉公共前后缀之后、且规模在预算内时调用。 */
function lcsParts(before, after) {
  const rows = before.length;
  const cols = after.length;
  // (rows+1) × (cols+1) 的表用一维 Int32Array 存，比嵌套数组省一大截
  const table = new Int32Array((rows + 1) * (cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const at = i * (cols + 1) + j;
      table[at] = before[i] === after[j]
        ? table[at + cols + 2] + 1
        : Math.max(table[at + cols + 1], table[at + 1]);
    }
  }
  const parts = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      parts.push({ type: "same", text: before[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * (cols + 1) + j] >= table[i * (cols + 1) + j + 1]) {
      parts.push({ type: "del", text: before[i] });
      i += 1;
    } else {
      parts.push({ type: "ins", text: after[j] });
      j += 1;
    }
  }
  while (i < rows) { parts.push({ type: "del", text: before[i] }); i += 1; }
  while (j < cols) { parts.push({ type: "ins", text: after[j] }); j += 1; }
  return parts;
}

/**
 * `before` → `after` 的字级 diff。
 *
 * 返回 `[{ type: "same" | "del" | "ins", text }]`，把三类的 text 按 same+del 拼起来等于
 * `before`，按 same+ins 拼起来等于 `after`——CodeMirror 那边靠这条不变式定位装饰区间。
 *
 * `degraded` 为 true 表示超预算退回了整段替换（一个 del + 一个 ins），调用方据此换一种呈现。
 */
export function diffTokens(before, after) {
  const source = String(before ?? "");
  const target = String(after ?? "");
  if (source === target) return { parts: source ? [{ type: "same", text: source }] : [], degraded: false };
  if (!source) return { parts: [{ type: "ins", text: target }], degraded: false };
  if (!target) return { parts: [{ type: "del", text: source }], degraded: false };

  const a = tokenize(source);
  const b = tokenize(target);

  // 大部分修订只动中段。先把两头一样的削掉，剩下的才进 LCS 表。
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const prefix = a.slice(0, head).join("");
  const suffix = a.slice(a.length - tail).join("");

  // 超预算：中段不逐字比，整块换掉。这个规模下逐字上色也读不出信息，只会变成一片花屏。
  const degraded = midA.length * midB.length > DIFF_BUDGET;
  const middle = degraded
    ? [{ type: "del", text: midA.join("") }, { type: "ins", text: midB.join("") }]
    : lcsParts(midA, midB);

  return {
    parts: merge([
      { type: "same", text: prefix },
      ...middle,
      { type: "same", text: suffix },
    ]),
    degraded,
  };
}

/** 变更规模。字符数而不是 token 数——「+42 / −18」里的数是给人读的，人数的是字。 */
export function diffStats(parts = []) {
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.type === "ins") added += part.text.length;
    else if (part.type === "del") removed += part.text.length;
  }
  return { added, removed, label: `+${added} / −${removed}` };
}

/**
 * 这次结果是**在改用户写下的字**，还是**产出了新的字**？
 *
 * 这条判据决定结果怎么呈现：改字 → 正文原位置画 diff；产新字 → 回答卡。
 *
 * 上一版是按**用户怎么唤起的**来判的：预设技能算改字，自由指令一律算产新字。
 * 那条判据在「选中一段，输入『润色优化一下』」上直接判错——用户明明在改字，
 * 结果却停在一张卡里，还得再点一次插入。而唤起方式本来就说明不了意图：
 * 同一个输入框里可以写「翻译成英文」，也可以写「把长句拆开」。
 *
 * 所以改成按**回来的东西**判：结果里保留了多少原文的字。翻译、提问、续写的重合度接近 0，
 * 润色、纠错、拆句的重合度很高。这是事后判据，比事前猜意图准。
 *
 * 分母取**较长的那一边**，判不准时偏向「回答卡」：卡片不碰正文，代价是多点一下；
 * 而误判成 diff 时「点空白 = 采纳」会把答案落进正文——两边的错代价不对称。
 */
export const EDIT_SIMILARITY = 0.5;

export function looksLikeEdit(before, after) {
  const source = String(before ?? "").trim();
  const target = String(after ?? "").trim();
  if (!source || !target) return false;
  const { parts } = diffTokens(source, target);
  let kept = 0;
  for (const part of parts) if (part.type === "same") kept += part.text.trim().length;
  return kept / Math.max(source.length, target.length) >= EDIT_SIMILARITY;
}
