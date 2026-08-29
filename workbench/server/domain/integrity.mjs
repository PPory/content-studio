import crypto from "node:crypto";
import { MATERIAL_TYPE_SET, VERBATIM_MATERIAL_TYPES, VERIFICATION } from "./values.mjs";

const PERSONAL_EXPERIENCE_TYPE = "个人经历";
const MAX_CLAIM_GAP = 8;
const MAX_CLAIMS = 5;
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

export function normalizeStoredText(value) {
  return String(value || "").replace(/\\r\\n|\\n/g, "\n");
}

export function isValidHttpSource(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function comparableText(value) {
  return String(value || "").normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
}

function materialText(material) {
  return material?.body_markdown ?? material?.bodyMarkdown ?? material?.note ?? material?.content ?? "";
}

export function sourceContainsVerbatim(sourceText, materialTextValue) {
  const source = comparableText(sourceText);
  const material = comparableText(materialTextValue);
  return Boolean(source && material && source.includes(material));
}

export function verificationForMaterial({ type, bodyMarkdown = "", sourceUrl = "", sourceText = "", origin = "manual" } = {}) {
  if (!MATERIAL_TYPE_SET.has(type)) throw new TypeError("素材类型不合法");
  if (!VERBATIM_MATERIAL_TYPES.has(type)) return { status: VERIFICATION.NA, note: "非逐字引用或数据素材，无需逐字核验。" };
  if (origin !== "auto-extract") return { status: VERIFICATION.PENDING, note: "手工直存的逐字素材，发布前需人工核对原文与出处。" };
  if (!isValidHttpSource(sourceUrl)) return { status: VERIFICATION.PENDING, note: "缺少有效的 http/https 出处链接，不能自动核验。" };
  if (!sourceContainsVerbatim(sourceText, bodyMarkdown)) return { status: VERIFICATION.PENDING, note: "抓取原文中未找到逐字一致内容，需人工核对。" };
  return { status: VERIFICATION.VERIFIED, note: "已在抓取原文中逐字匹配，并保留有效出处链接。" };
}

export function isMaterialEligibleForDraft(material) {
  const status = material?.verification_status ?? material?.verificationStatus ?? "";
  if (status === VERIFICATION.PENDING) return false;
  if (VERBATIM_MATERIAL_TYPES.has(material?.material_type ?? material?.type)) return status === VERIFICATION.VERIFIED;
  return true;
}

export function compactWithMap(value) {
  const source = String(value || "");
  let text = "";
  const map = [];
  for (let index = 0; index < source.length; index += 1) {
    for (const character of source[index].normalize("NFKC").toLowerCase()) {
      if (/\p{L}|\p{N}/u.test(character)) {
        text += character;
        map.push(index);
      }
    }
  }
  return { text, map };
}

function bigrams(value) {
  const compact = compactWithMap(value).text;
  const pairs = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) pairs.add(compact.slice(index, index + 2));
  return { compact, pairs };
}

export function isPersonalClaimGrounded(claim, evidence) {
  const claimData = bigrams(claim);
  const evidenceData = bigrams(evidence);
  if (claimData.compact.length < 6 || evidenceData.compact.length < 6) return false;
  if (claimData.compact.includes(evidenceData.compact) || evidenceData.compact.includes(claimData.compact)) return true;
  let overlap = 0;
  for (const pair of claimData.pairs) if (evidenceData.pairs.has(pair)) overlap += 1;
  return overlap >= 4 && overlap / Math.max(1, claimData.pairs.size) >= 0.5;
}

export function findSpecificPersonalClaims(value) {
  const source = normalizeStoredText(value).replace(/【待补：[\s\S]*?】|\[待补：[\s\S]*?\]/g, "");
  const spans = [];
  for (const pattern of PERSONAL_CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const start = Math.max(0, match.index ?? 0);
      const sentenceStart = Math.max(source.lastIndexOf("。", start - 1), source.lastIndexOf("！", start - 1), source.lastIndexOf("？", start - 1), source.lastIndexOf("\n", start - 1)) + 1;
      const endings = ["。", "！", "？", "\n"].map((mark) => source.indexOf(mark, start + match[0].length)).filter((index) => index >= 0);
      spans.push([sentenceStart, endings.length ? Math.min(...endings) + 1 : Math.min(source.length, start + 80)]);
    }
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span[0] <= previous[1] + MAX_CLAIM_GAP && !source.slice(previous[1], span[0]).trim()) previous[1] = Math.max(previous[1], span[1]);
    else merged.push([...span]);
  }
  return [...new Set(merged.map(([from, to]) => source.slice(from, to).trim()).filter(Boolean))].slice(0, MAX_CLAIMS);
}

export function auditPersonalNarrative(value, materials = []) {
  const claims = findSpecificPersonalClaims(value);
  const evidence = materials.filter((item) => (item.material_type ?? item.type) === PERSONAL_EXPERIENCE_TYPE && comparableText(materialText(item)));
  const ungrounded = claims.filter((claim) => !evidence.some((item) => isPersonalClaimGrounded(claim, materialText(item))));
  return { claims, ungrounded, evidenceCount: evidence.length };
}

export function generatedText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(generatedText).filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(generatedText).filter(Boolean).join("\n");
  return "";
}

export function assertGroundedGeneratedText(value, materials = []) {
  const audit = auditPersonalNarrative(generatedText(value), materials);
  if (!audit.ungrounded.length) return audit;
  const error = new Error(`检测到未被“个人经历”素材支撑的叙事：${audit.ungrounded.join("；")}`);
  error.code = "UNGROUNDED_PERSONAL_EXPERIENCE";
  error.claims = audit.ungrounded;
  throw error;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function sha256Json(value) {
  const encoded = JSON.stringify(value ?? null);
  const jsonSafeValue = encoded === undefined ? null : JSON.parse(encoded);
  return crypto.createHash("sha256").update(canonical(jsonSafeValue)).digest("hex");
}

export function stableTaskKey(kind, ...parts) {
  const prefix = String(kind || "task").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "task";
  return `${prefix}:${sha256Json([kind, ...parts]).slice(0, 32)}`;
}
