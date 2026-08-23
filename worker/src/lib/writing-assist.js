const MODES = new Set(["nudge", "paragraph", "finish"]);

/**
 * 写作推动的输入边界。浏览器传来的正文只作为这一次生成的上下文，不落库。
 * 保留开头和结尾：开头提供主题与口吻，结尾决定下一句该从哪里接。
 */
export function writingContext(value, limit = 16_000) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  const head = Math.min(3_000, Math.floor(limit / 3));
  const tail = limit - head - 24;
  return `${text.slice(0, head)}\n\n【中间内容已省略】\n\n${text.slice(-tail)}`;
}

/**
 * 光标附近才是这次推动真正要解决的位置。长文仍保留文章开头用于理解主题，
 * 但把更多预算留给光标前后，避免模型只看到文末就误以为作者卡在结尾。
 */
export function writingCursorContext(value, cursor, limit = 16_000) {
  const text = String(value || "");
  const numeric = Number(cursor);
  const at = Number.isFinite(numeric)
    ? Math.max(0, Math.min(text.length, Math.trunc(numeric)))
    : text.length;
  if (text.length <= limit) {
    return { cursor: at, overview: "", before: text.slice(0, at), after: text.slice(at), truncated: false };
  }

  const overviewSize = Math.min(2_400, Math.floor(limit / 5));
  const localBudget = limit - overviewSize;
  const beforeSize = Math.floor(localBudget * 0.58);
  const afterSize = localBudget - beforeSize;
  return {
    cursor: at,
    overview: text.slice(0, overviewSize),
    before: text.slice(Math.max(0, at - beforeSize), at),
    after: text.slice(at, Math.min(text.length, at + afterSize)),
    truncated: true,
  };
}

export function normalizeWritingAssistRequest(body = {}) {
  const mode = MODES.has(body.mode) ? body.mode : "nudge";
  const title = String(body.title || "").trim().slice(0, 160);
  const platform = String(body.platform || "").trim().slice(0, 24);
  const rawContent = String(body.content || "");
  const content = writingContext(rawContent);
  const context = writingCursorContext(rawContent, body.cursor);
  if (!title && !content) {
    const error = new Error("先写一个主题，或用一条起始句开头");
    error.status = 400;
    throw error;
  }
  const expert = String(body.expert || "").trim().slice(0, 6_000);
  const style = String(body.style || "").trim().slice(0, 6_000);
  return { mode, title, platform, content, expert, style, ...context };
}
