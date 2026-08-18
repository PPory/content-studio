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

export function normalizeWritingAssistRequest(body = {}) {
  const mode = MODES.has(body.mode) ? body.mode : "nudge";
  const title = String(body.title || "").trim().slice(0, 160);
  const platform = String(body.platform || "").trim().slice(0, 24);
  const content = writingContext(body.content);
  if (!title && !content) {
    const error = new Error("先写一个主题，或用一条起始句开头");
    error.status = 400;
    throw error;
  }
  return { mode, title, platform, content };
}
