// 内容真实性与任务幂等的纯逻辑。这里不能依赖 Notion、LLM 或 Workers 绑定，
// 以便用 Node 内置测试直接覆盖关键边界。

export const VERBATIM_MATERIAL_TYPES = new Set(["金句/原话", "数据/事实"]);
export const PERSONAL_EXPERIENCE_TYPE = "个人经历";

/**
 * 哪些素材类型能给第一人称叙事当证据——**类型清单只有这一份**。
 *
 * 它同时被两处用：这个文件里的闸门（`auditPersonalNarrative` 挑证据），和 `db.js`
 * 里那条取证据的 SQL（`WHERE type IN (…)`）。写死两遍的话，将来放宽类型时 SQL 那边
 * 会悄悄少捞一类——闸门收到的证据不全，症状是「明明录了素材还是报缺依据」，
 * 而两边代码单看都对。
 */
export const EVIDENCE_MATERIAL_TYPES = [PERSONAL_EXPERIENCE_TYPE];

export function isEvidenceMaterial(material) {
  return EVIDENCE_MATERIAL_TYPES.includes(material?.type) && Boolean(comparableText(material?.note));
}

// 两条叙事之间最多隔这么多字符的空白还算「连着的」。一个空行是 2 个字符，
// 给到 8 能容下 CRLF 和缩进；再放宽就可能跨过一整段被占位符掏空的正文。
const MAX_CLAIM_GAP = 8;

const PERSONAL_CLAIM_PATTERNS = [
  /(?:^|[。！？!?\n])\s*(?:前几天|昨天|上周|上个月|去年|几年前|有一次|记得|曾经|之前|当时)[，,、\s]*(?:我|我和|我跟|我在|我去|我做|我遇到|我认识)/g,
  /我(?:自己)?(?:也)?(?:曾经|曾|之前|过去|最近|前几天|上周|去年|当时|有一次)[^。！？!?\n]{0,50}(?:做过|去过|遇到|经历|发现|尝试|辞职|开始|失败|踩过|待过)/g,
  /(?:我有|我认识)(?:一个|一位|个)?(?:朋友|同事|客户|读者)/g,
  /(?:前几天|昨天|上周|上个月|去年|有一次)?[^。！？!?\n]{0,8}(?:跟|和)(?:一个|一位)?(?:朋友|同事|客户|读者)(?:聊天|聊|吃饭|见面|通话)/g,
  /(?:朋友|同事|客户|读者)[^。！？!?\n]{0,12}(?:跟|对)我(?:说|聊|问|抱怨|提到)/g,
  /我(?:问|告诉|回复|回答)(?:了)?(?:他|她|朋友|同事|客户|读者)/g,
  /我的(?:朋友|同事|客户|读者)/g,
  /我(?:自己)?(?!认为|建议|觉得|相信|观察)[^。！？!?\n]{0,18}(?:辞职|创业|采访过|见过|拿到|赚到|花了|做过|写过|发布过)[^。！？!?\n]{0,40}/g,
];

/**
 * 正文归一：把**字面的 `\n`**（反斜杠 + n 两个字符）还原成真换行。
 *
 * 来源不是解析 bug——模型往 JSON 里写 `\\n` 双重转义，`parseLooseJson` 忠实地解成了
 * 那两个字符，存进库就是 `Step 1 …\nStep 2 …`。**症状只在阅读时暴露**：素材卡片、
 * vault 里的 md、拼进成稿提示词的那一段，全都带着满屏 `\n`，而没有任何一处会报错。
 *
 * 放在存储这一侧而不是显示那一侧：显示有四五个入口（工作台卡片、vault 归档、
 * 成稿提示词、Bot 回执），修显示等于同一条规则写四遍，而且新入口一定会漏。
 *
 * 只认 `\n` / `\r\n`，不动 `\t` 和别的转义：真要在正文里写「反斜杠 n」这两个字符的
 * 场景（讲转义、贴代码）虽然少，但存在；换行是唯一一个「肯定是本意」的。
 */
export function normalizeStoredText(value) {
  return String(value || "").replace(/\\r\\n|\\n/g, "\n");
}

export function isValidHttpSource(value) {
  try {
    const url = new URL(String(value || ""));
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function comparableText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceContainsVerbatim(sourceText, materialText) {
  const source = comparableText(sourceText);
  const material = comparableText(materialText);
  return Boolean(source && material && source.includes(material));
}

/**
 * 逐字类只有在自动抽取、出处为有效 URL、且抓取原文能逐字比对时才是「已核验」。
 * 手工直存即使带 URL 也默认「待核验」，避免把“用户填过出处”误当成“系统核过原文”。
 */
export function verificationForMaterial({ type, note, sourceUrl = "", sourceText = "", origin = "manual" }) {
  if (!VERBATIM_MATERIAL_TYPES.has(type)) {
    return { status: "不适用", note: "非逐字引用或数据素材，无需逐字核验。" };
  }
  if (origin !== "auto-extract") {
    return { status: "待核验", note: "手工直存的逐字素材，发布前需人工核对原文与出处。" };
  }
  if (!isValidHttpSource(sourceUrl)) {
    return { status: "待核验", note: "缺少有效的 http/https 出处链接，不能自动核验。" };
  }
  if (!sourceContainsVerbatim(sourceText, note)) {
    return { status: "待核验", note: "出处链接有效，但抓取原文中未找到逐字一致内容，需人工核对。" };
  }
  return { status: "已核验", note: "已在抓取原文中逐字匹配，并保留有效出处链接。" };
}

export function isMaterialEligibleForDraft({ type, verificationStatus = "" }) {
  if (verificationStatus === "待核验") return false;
  if (VERBATIM_MATERIAL_TYPES.has(type)) return verificationStatus === "已核验";
  return true;
}

export function hasPersonalExperienceEvidence(materials = []) {
  return materials.some(isEvidenceMaterial);
}

/**
 * 归一化成「只剩字母数字」的比较用文本，**并留下每个字符回到原文的下标**。
 *
 * `map[i]` 是 `text[i]` 在原始字符串里的位置。引用标注要靠它把匹配上的那一段
 * 换算回正文里的真实区间（`lib/cite.js`）——没有这张表，匹配只能回答「像不像」，
 * 回答不了「在哪一句」。
 *
 * ⚠️ **`compactForGrounding` 必须走这一个实现。** 闸门判「有没有依据」、引用判
 * 「哪一句来自哪条」，用的得是同一套归一化；各写一份的话，某天全角/空白的处理
 * 差一点，就会出现「闸门放行了，但一条引用都标不出来」这种没人看得懂的现象。
 */
export function compactWithMap(value) {
  const source = String(value || "");
  let text = "";
  const map = [];
  for (let i = 0; i < source.length; i++) {
    // 逐字符 NFKC：整串归一化会改变长度，下标就对不回原文了
    for (const ch of source[i].normalize("NFKC").toLowerCase()) {
      if (/[\p{L}\p{N}]/u.test(ch)) {
        text += ch;
        map.push(i);
      }
    }
  }
  return { text, map };
}

function compactForGrounding(value) {
  return compactWithMap(value).text;
}

/** 已归一化文本的相邻二字组，**按出现顺序**。引用要滑窗，所以需要序列而不只是集合。 */
export function bigramList(compactText) {
  const out = [];
  for (let i = 0; i < compactText.length - 1; i++) out.push(compactText.slice(i, i + 2));
  return out;
}

function bigrams(value) {
  return new Set(bigramList(compactForGrounding(value)));
}

// 一条「个人经历」只能支撑与自身内容高度重合的叙事，不能成为放行任意故事的通行证。
// 阈值有意保守：宁可要求作者补素材，也不让模型把无关经历扩写成新事实。
export function isPersonalClaimGrounded(claim, materialNote) {
  const claimText = compactForGrounding(claim);
  const evidenceText = compactForGrounding(materialNote);
  if (claimText.length < 6 || evidenceText.length < 6) return false;
  if (claimText.includes(evidenceText) || evidenceText.includes(claimText)) return true;

  const claimPairs = bigrams(claimText);
  const evidencePairs = bigrams(evidenceText);
  let overlap = 0;
  for (const pair of claimPairs) if (evidencePairs.has(pair)) overlap++;
  return overlap >= 4 && overlap / Math.max(1, claimPairs.size) >= 0.5;
}

function withoutPlaceholders(text) {
  return String(text || "")
    .replace(/【待补：[\s\S]*?】/g, "")
    .replace(/\[待补：[\s\S]*?\]/g, "");
}

const MAX_CLAIMS = 5;

/**
 * 找出「具体到可以求证」的第一人称叙事。
 *
 * ⚠️ **连着的几句算一条，不是几条。**「前几天跟一个朋友聊天…」和紧跟着的「我问他：…」
 * 是同一个场景的两句话，拆成两条会有两个后果，都不轻：界面上让人以为有两处待办；
 * 而补录时只填其中一句，另一句照样够不着依据——补了还在报，看着像修不好。
 * 判据是**两句之间只隔空白**（含空行）：中间夹着别的正文就说明是两件事，不并。
 *
 * 先过一遍 `normalizeStoredText`：库里有些正文存的是字面的 `\\n` 两个字符
 *（LLM 转义了两遍），不还原的话段落之间隔的不是空白而是那两个字符，上面那条合并规则
 * 永远不生效——而现象只是「明明是一段话，却报了两处」。
 */
export function findSpecificPersonalClaims(text) {
  const source = withoutPlaceholders(normalizeStoredText(text));
  const spans = [];
  for (const pattern of PERSONAL_CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      // 正则只负责发现风险信号；用于证据匹配时扩展到所在整句，避免只拿到“上周我”
      // 这类过短片段，既误拦真实经历，也无法区分不同故事。
      const start = Math.max(0, match.index ?? 0);
      const sentenceStart = Math.max(
        source.lastIndexOf("。", start - 1), source.lastIndexOf("！", start - 1),
        source.lastIndexOf("？", start - 1), source.lastIndexOf("\n", start - 1)
      ) + 1;
      const endings = ["。", "！", "？", "\n"]
        .map((mark) => source.indexOf(mark, start + match[0].length))
        .filter((index) => index >= 0);
      const sentenceEnd = endings.length ? Math.min(...endings) + 1 : Math.min(source.length, start + 80);
      if (sentenceEnd > sentenceStart) spans.push([sentenceStart, sentenceEnd]);
      else if (match[0].trim()) spans.push([start, start + match[0].length]);
    }
  }

  // **按出现顺序**排，不按正则顺序：合并只能在文档序上做，而顺序本身也该和正文一致。
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [from, to] of spans) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1] + MAX_CLAIM_GAP && !source.slice(last[1], from).trim()) {
      last[1] = Math.max(last[1], to);
      continue;
    }
    merged.push([from, to]);
  }

  const hits = [];
  for (const [from, to] of merged) {
    const value = source.slice(from, to).trim();
    if (value && !hits.includes(value)) hits.push(value);
    if (hits.length >= MAX_CLAIMS) break;
  }
  return hits;
}

export function assertGroundedPersonalNarrative(text, materials = []) {
  const audit = auditPersonalNarrative(text, materials);
  if (!audit.ungrounded.length) return;
  const error = new Error(`检测到未被「个人经历」素材确定性支撑的叙事：${audit.ungrounded.join("；")}。请补录对应经历，或改为【待补：真实经历】后再落库。`);
  error.code = "UNGROUNDED_PERSONAL_EXPERIENCE";
  error.claims = audit.ungrounded;
  throw error;
}

export function auditPersonalNarrative(text, materials = []) {
  const claims = findSpecificPersonalClaims(text);
  const experiences = materials.filter(isEvidenceMaterial);
  const ungrounded = claims.filter((claim) => !experiences.some((m) => isPersonalClaimGrounded(claim, m.note)));
  return { claims, ungrounded, evidenceCount: experiences.length };
}

// 把模型返回的标题、摘要、正文、备选标题等所有可见文本压平后一次校验，
// 避免只守正文、旁路字段仍能写入编造经历。
export function generatedText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(generatedText).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value).map(generatedText).filter(Boolean).join("\n");
  }
  return "";
}

export function assertGroundedGeneratedText(value, materials = []) {
  return assertGroundedPersonalNarrative(generatedText(value), materials);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function hash32(text, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function stableTaskKey(kind, ...parts) {
  const prefix = String(kind || "task").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "task";
  const raw = canonical([kind, ...parts]);
  return `${prefix}:${hash32(raw, 0x811c9dc5)}${hash32(raw, 0x9e3779b9)}`;
}

export function workflowInstanceId(kind, entity, revision = "") {
  return stableTaskKey(`wf-${kind}`, entity, revision).replace(":", "-");
}

export function primaryPlatform(platforms = []) {
  return platforms.find(Boolean) || "";
}

export function topicStatusFromDrafts(targetPlatforms = [], drafts = []) {
  const main = primaryPlatform(targetPlatforms);
  if (!drafts.length) return "待写";
  if (!main) return "搁置";
  const matches = drafts.filter((draft) => draft?.platform === main);
  if (!matches.length) return "搁置";
  return matches.some((draft) => draft.status === "已发布") ? "已发布" : "已成稿";
}
