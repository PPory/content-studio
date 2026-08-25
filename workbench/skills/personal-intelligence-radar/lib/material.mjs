// 材料文件的公共部件：周数、取值、截断、写盘。三个源共用，免得各写一份走样。

import { writeVaultFile } from "../../../server/lib/vault.mjs";

/** ISO 周号，例 2026-W33。材料按周聚合，所以文件名用它 */
export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400_000 + 1) / 7)).padStart(2, "0")}`;
}

/**
 * 按一串候选键名取值。
 *
 * 上游的输出 schema 官方文档基本不写全，字段名只能从真实数据里认。给一串候选、
 * 取到哪个算哪个，比写死一个安全——写死的那个字段哪天改名，材料会**安静地少一块**，
 * 不报错。原始 JSON 同时存进 tmp/，对着看就能把候选收紧。
 */
export const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
};

export const asNum = (v) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const clip = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

/** 压成一行：材料里的引用不需要保留原文换行，留着只会把列表撑散 */
export const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * 「信息量长度」：中日韩字符按 2.5 倍算。
 *
 * **按字符数卡长度门槛，是在系统性地砍掉中文内容。** 60 个中文字是一个带完整
 * 判断的句子（「看来某家公司要发布新的 Agent 了，他们注册了新的团队账号
 * 团队的公众号」——一条独家线索，58 个字），60 个英文字符还不到一个从句。
 * 实测 X 的中文账号被这条规则砍掉的全是有内容的，而英文那边砍掉的确实是
 * 「ai」「fav button on LI right now」这类废话——**同一个数字，两种结果**。
 *
 * 2.5 这个系数不用很准：它只是让「一句完整的中文」和「一句完整的英文」落在
 * 门槛的同一侧，不是要精确度量信息熵。
 */
export const infoLen = (s) => {
  const t = String(s || "");
  // 汉字 + 中日韩标点 + 全角字符
  const cjk = (t.match(/[一-鿿　-〿＀-￯]/g) || []).length;
  return t.length - cjk + cjk * 2.5;
};

/** 中位数。用它而不是平均数，免得一条长文本把一屏短句拉过线 */
export const median = (nums) => {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** 只保留 days 天内的。**日期解析不出来的留下**——宁可多给，不要静默丢内容 */
export function withinDays(items, days, dateOf) {
  const cutoff = Date.now() - days * 86400_000;
  return items.filter((it) => {
    const t = Date.parse(dateOf(it));
    return !Number.isFinite(t) || t >= cutoff;
  });
}

// 洞察在 vault 里的位置。工作台那边的单一真源是 `server/lib/vault-dirs.mjs`，
// 但 skill 是独立跑的、不 import 工作台的代码，所以这里只能同步一份。
// **改了那边记得改这里**——不同步的表现是材料写进一个工作台不看的目录，
// 洞察页显示「还没有洞察报告」，而文件其实好好地躺在旧路径上。
export const INSIGHT_DIR = "99 - 个人工作台/02 - 洞察";

/**
 * 材料写进 <洞察>/_material/ 这个**子目录**，不是洞察根下。
 *
 * 工作台的洞察页只列 kind === "file"，子目录整个不进列表——所以原始材料在
 * Obsidian 里搜得到、skill 读得到，但不会混进报告列表里假装自己是一份报告。
 */
export function writeMaterial(root, name, md) {
  return writeVaultFile(root, `${INSIGHT_DIR}/_material/${name}`, md);
}

/** 材料文件统一的头：frontmatter + 标题 + 一句「这是材料不是报告」 */
export function header({ source, week, days, stats, note }) {
  return [
    "---",
    `generated: ${new Date().toISOString()}`,
    `source: ${source}`,
    `window_days: ${days}`,
    ...Object.entries(stats).map(([k, v]) => `${k}: ${v}`),
    "---",
    "",
    `# ${note.title} · ${week}`,
    "",
    `> 这是**原始材料，不是报告**。social-insights skill 读完之后写的报告在 \`${INSIGHT_DIR}/\` 根目录。`,
    `> ${note.desc}`,
    "",
  ];
}
