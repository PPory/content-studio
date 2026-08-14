// 文章正文抓取：优先 Jina Reader（干净 Markdown，公众号等反爬站必需），
// 失败/限流时降级为直接抓原页 + 粗提纯文本（多数博客/Substack 可用）。
// 全部失败返回 { ok: false }，由初筛 prompt 的失败兜底处理，不编造内容。

const MAX_BODY_CHARS = 20000; // 控制 LLM 输入长度

export async function fetchArticle(url, env = {}) {
  const viaJina = await fetchViaJina(url, env.JINA_API_KEY);
  if (viaJina.ok) return viaJina;
  const direct = await fetchDirect(url);
  if (direct.ok) return direct;
  return { ok: false, reason: `jina: ${viaJina.reason}; direct: ${direct.reason}` };
}

async function fetchViaJina(url, apiKey) {
  try {
    const headers = { "x-return-format": "markdown" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch("https://r.jina.ai/" + url, { headers });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const text = (await res.text()).trim();
    if (!text) return { ok: false, reason: "empty body" };
    // Jina 返回的首个非空行通常形如 "Title: xxx"
    const titleLine = text.split("\n").find((l) => l.trim());
    const title = titleLine?.replace(/^Title:\s*/i, "").trim() || "";
    return { ok: true, title, body: text.slice(0, MAX_BODY_CHARS) };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 150) };
  }
}

async function fetchDirect(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const html = await res.text();
    const title = extractTitle(html);
    const body = htmlToText(html);
    if (body.length < 200) return { ok: false, reason: "extracted text too short" };
    return { ok: true, title, body: body.slice(0, MAX_BODY_CHARS) };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 150) };
  }
}

// 标题提取：优先 og:title / twitter:title（公众号等站点 <title> 常为空，og:title 才是真标题），
// 退回 <title>。content 属性在 property 前或后都能取。返回已解码实体的纯文本。
function extractTitle(html) {
  const cand = metaContent(html, "og:title")
    || metaContent(html, "twitter:title")
    || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  return decodeEntities(cand.trim());
}

function metaContent(html, key) {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*?content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${key}["']`, "i");
  return (html.match(re1)?.[1] || html.match(re2)?.[1] || "").trim();
}

function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:nav|header|footer|aside)[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, " ");
  // 优先取 article / main 区块
  const region = s.match(/<article[\s\S]*?<\/article>/i)?.[0] || s.match(/<main[\s\S]*?<\/main>/i)?.[0] || s;
  return decodeEntities(
    region
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(s) {
  const map = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…" };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (m) => map[m] ?? m);
}
