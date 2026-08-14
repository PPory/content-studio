// Telegram 发消息封装：webhook 回执与 Workflow 异步回执共用。

export async function reply(env, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error(`telegram reply failed: ${res.status} ${await res.text()}`);
}

// Telegram 单条消息上限 4096 字符：按分隔线切段发送，段内仍超长再硬切
export async function replyLong(env, chatId, text, separator = "\n\n————————\n\n") {
  const LIMIT = 3600;
  if (text.length <= LIMIT) {
    await reply(env, chatId, text);
    return;
  }
  let buf = "";
  for (const part of text.split(separator)) {
    const piece = part.length > LIMIT ? part.slice(0, LIMIT) + "…" : part;
    if (buf && buf.length + piece.length > LIMIT) {
      await reply(env, chatId, buf);
      buf = piece;
    } else {
      buf = buf ? `${buf}${separator}${piece}` : piece;
    }
  }
  if (buf) await reply(env, chatId, buf);
}
