// 正文里的哪一句，来自哪条素材。纯逻辑，不碰 D1、不调 LLM，node 测直接覆盖。
//
// ## 为什么是文本对齐，不是让模型自己标脚注
//
// **这套东西只会漏标，不会错标——这就是选它的全部理由。**
//
// 漏标（改写太狠、对不上）的后果是：用户看到一句没有出处，自己去核一遍，最坏也就是
// 回到没有标注的状态。错标（把模型编的一句挂到某条素材下面）的后果是：用户看到有出处，
// **于是不核了**——那比没有标注更糟，因为它把「你得自己判断」变成了「系统说有据」。
//
// 让模型在生成时自己吐 `[^1]` 又快又全，但它标错的时候一点声音都没有。所以阈值宁可高、
// 宁可漏，`MIN_SCORE` 往下调之前先想清楚：多标出来的那些，谁来保证是对的。
//
// ## 为什么是滑窗，不是整条素材算重合
//
// 拿整条素材的二字组集合去比，**素材越长越容易命中**：一条两千字的复盘，它的二字组
// 几乎覆盖了常用中文，任何一句话都能「有一半的词在里面」。那正是错标的来源。
// 所以匹配的是素材里**和这句话最像的那一小段**，顺带也就知道该把哪段原话浮出来给用户看。

import { bigramList, compactWithMap } from "./integrity.js";

// 太短的句子标了也没信息量（「说白了呢？」），而且短句碰巧撞上的概率高得多
const MIN_CHARS = 12;
// 绝对下限，挡住「这不是信息太多的问题」这类通用短句：比例够但实际重合没几个字
const MIN_OVERLAP = 8;
// 这句话有多大比例被素材里那一段覆盖。0.62 大约是「明显在复述同一件事」的位置
const MIN_SCORE = 0.62;
// 浮出来给用户看的素材原话长度上限
const QUOTE_CHARS = 80;

/** 代码围栏里的东西不参与标注：那是示例代码，不是从素材复述来的观点。 */
function fencedRanges(text) {
  const out = [];
  const fence = /```/g;
  let match;
  let open = null;
  while ((match = fence.exec(text))) {
    if (open === null) open = match.index;
    else {
      out.push([open, match.index + 3]);
      open = null;
    }
  }
  if (open !== null) out.push([open, text.length]); // 没闭合的围栏，后面整段都算代码
  return out;
}

/**
 * 按句切分，**保留每一句在原文里的区间**。
 * 返回的 start/end 是原始字符串下标，前端直接拿去当编辑器里的位置用。
 */
export function splitSentences(text) {
  const source = String(text || "");
  const fenced = fencedRanges(source);
  const inFence = (index) => fenced.some(([a, b]) => index >= a && index < b);

  const out = [];
  let start = 0;
  const push = (from, to) => {
    // 掐掉两端空白和 Markdown 的行首记号，标注区间才不会框住半个 `## `
    let a = from;
    let b = to;
    /**
     * 行首的**块级**记号（`## `、`> `、`- `）跳过——它们是这一行的容器，不是这句话。
     * 但行内的强调记号（`**`）**要留在区间里**：它属于这段文字，切在底纹外面的话，
     * 一句话的底纹会从 `**加粗内容**` 的两头断开，看着像标歪了。
     */
    while (a < b && /[\s>#\-+|]/.test(source[a])) a++;
    if (/^[*+]\s/.test(source.slice(a, a + 2))) a += 2; // 用 `*` 当项目符号的列表
    while (a < b && /\s/.test(source[a])) a++;
    while (b > a && /\s/.test(source[b - 1])) b--;
    if (b - a < MIN_CHARS || inFence(a)) return;
    /**
     * 句末紧跟的强调闭合记号（`**`、`` ` ``）也算进区间里。
     * 不算的话，脚标就插在 `。` 和 `**` 中间——`…自己的人生。¹**`，
     * 把一对记号从中间切开，看着像正文里多了两个星号。
     * 下一句的起点本来就会跳过这些记号（上面那行 trim），所以不会两段重叠。
     */
    while (b < source.length && /[*_`~]/.test(source[b])) b++;
    out.push({ start: a, end: b });
  };
  for (let i = 0; i < source.length; i++) {
    if (/[。！？!?\n]/.test(source[i])) {
      push(start, i + 1);
      start = i + 1;
    }
  }
  push(start, source.length);
  return out;
}

/**
 * 在 `seq` 里找一个宽 `width` 的窗口，使窗口内**不重复地**命中 `want` 的二字组最多。
 * 增删两端各 O(1)，整体 O(seq)。
 */
function bestWindow(want, seq, width) {
  const counts = new Map();
  let distinct = 0;
  let best = 0;
  let bestAt = 0;
  for (let i = 0; i < seq.length; i++) {
    const entering = seq[i];
    if (want.has(entering)) {
      const seen = counts.get(entering) || 0;
      counts.set(entering, seen + 1);
      if (seen === 0) distinct++;
    }
    if (i >= width) {
      const leaving = seq[i - width];
      if (want.has(leaving)) {
        const seen = counts.get(leaving) - 1;
        counts.set(leaving, seen);
        if (seen === 0) distinct--;
      }
    }
    if (distinct > best) {
      best = distinct;
      bestAt = Math.max(0, i - width + 1);
    }
  }
  return { hit: best, at: bestAt };
}

function prepareSource(source) {
  const { text, map } = compactWithMap(source?.text);
  return { id: String(source?.id || ""), raw: String(source?.text || ""), compact: text, map, seq: bigramList(text), set: new Set(bigramList(text)) };
}

/** 把命中的窗口换算回素材原文，截成一句能浮出来看的原话。 */
function quoteAt(source, at, width) {
  if (!source.map.length) return "";
  const from = source.map[Math.min(at, source.map.length - 1)];
  const lastPair = Math.min(at + width, source.compact.length - 1);
  const to = source.map[Math.max(0, Math.min(lastPair, source.map.length - 1))] + 1;
  const slice = source.raw.slice(from, to).replace(/\s+/g, " ").trim();
  return slice.length > QUOTE_CHARS ? `${slice.slice(0, QUOTE_CHARS)}…` : slice;
}

/**
 * 标出正文里每一句的来源。
 *
 * @param {string} text 正文（Markdown 原文）
 * @param {Array<{id: string, text: string}>} sources 素材，**必须是从库里读出来的原文**
 * @returns {Array<{id, start, end, score, quote}>} 按正文顺序，一句最多归一条素材
 */
export function citeText(text, sources = []) {
  const body = String(text || "");
  const prepared = (Array.isArray(sources) ? sources : [])
    .map(prepareSource)
    .filter((s) => s.id && s.compact.length >= MIN_CHARS);
  if (!body || !prepared.length) return [];

  const out = [];
  for (const { start, end } of splitSentences(body)) {
    const { text: compact } = compactWithMap(body.slice(start, end));
    if (compact.length < MIN_CHARS) continue;
    const wantList = bigramList(compact);
    const want = new Set(wantList);
    if (want.size < MIN_OVERLAP) continue;

    let winner = null;
    for (const source of prepared) {
      // 先用整条素材的集合算一次上界：滑窗命中不可能超过它，超不过阈值就没必要滑。
      // 绝大多数「这句和这条素材无关」在这里就 O(句长) 地结束了。
      let ceiling = 0;
      for (const pair of want) if (source.set.has(pair)) ceiling++;
      if (ceiling < MIN_OVERLAP || ceiling / want.size < MIN_SCORE) continue;

      const width = Math.min(source.seq.length, Math.max(wantList.length * 2, 40));
      const { hit, at } = bestWindow(want, source.seq, width);
      const score = hit / want.size;
      if (hit < MIN_OVERLAP || score < MIN_SCORE) continue;
      if (!winner || score > winner.score) {
        winner = {
          id: source.id,
          start,
          end,
          score: Number(score.toFixed(3)),
          quote: quoteAt(source, at, width),
          // 带上被标的这句原文：用户改了正文之后，界面靠它一句 `slice(start,end) !== text`
          // 就能判出标注过时，把它变灰而不是继续举着一个可能已经不成立的出处
          text: body.slice(start, end),
        };
      }
    }
    if (winner) out.push(winner);
  }
  return out;
}
