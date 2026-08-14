// X 帖子抓取：x.com 有登录墙，Jina/直抓均不可靠。走 FxEmbed（原 FxTwitter）公开
// JSON API（无鉴权，限速 1000 req/min/IP），失败降级 vxTwitter；全挂返回 ok:false，
// 由命令层提示用户直接把帖子原文粘过来。

const STATUS_RE = /(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status(?:es)?\/(\d+)/i;

// x.com/twitter.com 帖子链接 → { user, id }；不是帖子链接返回 null
export function parseStatusUrl(url) {
  const m = (url || "").match(STATUS_RE);
  return m ? { user: m[1], id: m[2] } : null;
}

// 返回 { ok, text, author, quote?, reason? }；quote 是被引用帖 { text, author }
export async function fetchXPost(url) {
  const parsed = parseStatusUrl(url);
  if (!parsed) return { ok: false, reason: "not an x.com status url" };
  const viaFx = await fetchViaFx(parsed.id);
  if (viaFx.ok) return viaFx;
  const viaVx = await fetchViaVx(parsed.user, parsed.id);
  if (viaVx.ok) return viaVx;
  return { ok: false, reason: `fxtwitter: ${viaFx.reason}; vxtwitter: ${viaVx.reason}` };
}

async function fetchViaFx(id) {
  try {
    const res = await fetch(`https://api.fxtwitter.com/2/status/${id}`, {
      headers: { "User-Agent": "content-pipeline-bot" },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    // v2 用 status 字段，v1 用 tweet；code 非 200 表示帖子取不到（删除/受保护）
    const st = data.status || data.tweet;
    if (data.code !== 200 || !st?.text) return { ok: false, reason: data.message || "no status in response" };
    return {
      ok: true,
      text: st.article?.text || st.text,
      author: fmtAuthor(st.author?.name, st.author?.screen_name),
      quote: st.quote?.text
        ? { text: st.quote.text, author: fmtAuthor(st.quote.author?.name, st.quote.author?.screen_name) }
        : null,
    };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 150) };
  }
}

async function fetchViaVx(user, id) {
  try {
    const res = await fetch(`https://api.vxtwitter.com/${user}/status/${id}`, {
      headers: { "User-Agent": "content-pipeline-bot" },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data?.text) return { ok: false, reason: "no text in response" };
    return {
      ok: true,
      text: data.text,
      author: fmtAuthor(data.user_name, data.user_screen_name),
      quote: data.qrt?.text
        ? { text: data.qrt.text, author: fmtAuthor(data.qrt.user_name, data.qrt.user_screen_name) }
        : null,
    };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 150) };
  }
}

function fmtAuthor(name, handle) {
  if (name && handle) return `${name} (@${handle})`;
  return name || (handle ? `@${handle}` : "未知作者");
}
