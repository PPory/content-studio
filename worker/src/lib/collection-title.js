function cleanTitle(value) {
  return String(value || "").replace(/[\u200B-\u200F\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

function comparable(value) {
  return cleanTitle(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function titleRepeatsExcerpt(title, excerpt) {
  const a = comparable(title);
  const b = comparable(excerpt);
  if (a.length < 12 || b.length < 12) return false;
  const aLead = a.slice(0, Math.min(40, a.length));
  const bLead = b.slice(0, Math.min(40, b.length));
  return a === b || a.includes(bLead) || b.includes(aLead);
}

function hostLabel(url) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "网页"; }
  if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(host)) return "X";
  if (/(^|\.)substack\.com$/.test(host)) return "Substack";
  if (/(^|\.)feishu\.cn$|(^|\.)larksuite\.com$/.test(host)) return "飞书";
  return host || "网页";
}

function socialPostTitle(title, url) {
  const site = hostLabel(url);
  if (site !== "X" && site !== "Substack") return "";
  const raw = cleanTitle(title).replace(/^\(\d+\)\s*/, "");
  const author = raw.match(/^(.{1,80}?)\s*[:：]\s*["“”'‘]/)?.[1]?.trim();
  return author ? `${author} 的帖子`.slice(0, 200) : `${site} 上的帖子`;
}

export function collectionTitle({ title, url, selection, content, source }) {
  const raw = cleanTitle(title);
  const excerpt = cleanTitle(selection || content);
  const generatedByExtension = String(source || "").trim() === "浏览器扩展";
  if (raw && (!generatedByExtension || (!titleRepeatsExcerpt(raw, excerpt) && !/^(?:主页|Home)\s*\/\s*X$/i.test(raw)))) return raw;
  const social = generatedByExtension ? socialPostTitle(raw, url) : "";
  if (social) return social;
  if (generatedByExtension && url && excerpt) return `${hostLabel(url)} · 摘录`;
  if (raw) return raw;
  if (selection) return cleanTitle(selection.slice(0, 60));
  const firstLine = String(content || "").split(/\r?\n/).find((line) => line.trim());
  if (firstLine) return cleanTitle(firstLine.slice(0, 60));
  try { return new URL(url).hostname; } catch { return "未命名收藏"; }
}
