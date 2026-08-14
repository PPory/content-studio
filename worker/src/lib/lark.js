// 飞书开放平台封装：凭证、发消息、事件解密。
//
// 和 Telegram 那套（lib/tg.js）的三个结构性差别，改代码前先建立预期：
//
//  1. **凭证会过期。** Telegram 的 bot token 是静态的，飞书的 tenant_access_token
//     只有 2 小时。每次调用前都要确保手里的没过期。
//  2. **事件可能是加密的。** 后台配了 Encrypt Key 的话，webhook 收到的是
//     `{"encrypt":"..."}`，要先 AES-256-CBC 解开才知道里面是什么。
//  3. **消息内容是字符串套字符串。** `content` 字段本身是一个 JSON **字符串**，
//     里面才是 `{"text":"..."}`。发和收都要多一层 stringify/parse。

const BASE = "https://open.feishu.cn/open-apis";

// ---------------------------------------------------------------------------
// 凭证
// ---------------------------------------------------------------------------

/**
 * token 缓存在模块级变量里。
 *
 * 不落 D1/KV 是有意的：那样每次调用都要多一次读，而 Worker 的 isolate 通常能活
 * 几分钟到几小时，命中率足够高。最坏情况是冷启动多花一次请求——比每次都读一次库便宜。
 * 提前 5 分钟过期，避免拿着一个正好在路上失效的 token。
 */
let cached = { token: "", expiresAt: 0 };

export async function larkToken(env) {
  const now = Date.now();
  if (cached.token && cached.expiresAt > now) return cached.token;

  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.LARK_APP_ID, app_secret: env.LARK_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`lark token failed: ${data.code} ${data.msg}`);

  cached = { token: data.tenant_access_token, expiresAt: now + (data.expire - 300) * 1000 };
  return cached.token;
}

/**
 * 带凭证的 API 调用。
 *
 * **飞书的错误不走 HTTP 状态码**：业务失败照样返回 200，真实结果在 body 的 `code`
 * 里。只看 `res.ok` 的话，权限没开、参数写错这类问题会被当成成功静默吞掉。
 */
export async function larkFetch(env, path, { method = "GET", body, query } = {}) {
  const token = await larkToken(env);
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (data.code !== 0) {
    throw new Error(`lark ${method} ${path} -> ${data.code}: ${String(data.msg).slice(0, 200)}`);
  }
  return data.data;
}

// ---------------------------------------------------------------------------
// 发消息
// ---------------------------------------------------------------------------

/**
  * 发消息。
  *
  * `idType` 默认是 chat_id（从消息事件里拿得到），但 **cron 推送时只有机主的
  * open_id**——那时没有任何会话上下文，所以这个参数必须能换。
  */
async function send(env, receiveId, msgType, content, idType = "chat_id") {
  return larkFetch(env, "/im/v1/messages", {
    method: "POST",
    query: { receive_id_type: idType },
    // content 要的是**序列化后的字符串**，不是对象。传对象进去飞书会回参数错误
    body: { receive_id: receiveId, msg_type: msgType, content: JSON.stringify(content) },
  });
}

export function sendText(env, receiveId, text, idType) {
  return send(env, receiveId, "text", { text: String(text ?? "") }, idType);
}

/** 交互卡片。`card` 是卡片 JSON，构造见 lib/lark-card-builder.js。 */
export function sendCard(env, receiveId, card, idType) {
  return send(env, receiveId, "interactive", card, idType);
}

/**
 * 长文本分条发。
 *
 * 飞书单条文本上限 150KB，比 Telegram 的 4096 字符宽裕得多，所以这里的阈值是为
 * **可读性**设的，不是为接口限制：一条几千字的消息在手机上是一堵墙。按段落切，
 * 不在句子中间断开。
 */
export async function sendLong(env, receiveId, text, chunkSize = 3000, idType) {
  const s = String(text ?? "");
  if (s.length <= chunkSize) return sendText(env, receiveId, s, idType);

  const parts = [];
  let buf = "";
  for (const para of s.split("\n\n")) {
    if (buf && buf.length + para.length + 2 > chunkSize) {
      parts.push(buf);
      buf = para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  if (buf) parts.push(buf);

  for (const [i, part] of parts.entries()) {
    await sendText(env, receiveId, parts.length > 1 ? `（${i + 1}/${parts.length}）\n${part}` : part, idType);
  }
}

// ---------------------------------------------------------------------------
// 事件解密
// ---------------------------------------------------------------------------

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 解开 `{"encrypt":"..."}`。
 *
 * 算法是 AES-256-CBC：key = sha256(Encrypt Key)，**IV 是密文的前 16 字节**
 * （不是固定值，也不是另外传的），PKCS#7 填充由 WebCrypto 自己去掉。
 */
export async function decryptEvent(encryptKey, encrypted) {
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptKey));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const raw = base64ToBytes(encrypted);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: raw.slice(0, 16) },
    key,
    raw.slice(16)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * 把 webhook 收到的 body 还原成事件对象。
 *
 * 加不加密由后台配置决定，这里两种都认——**不能假设一定加密**：Encrypt Key 是选填的，
 * 而且调试期常常先不填。
 */
export async function readEvent(env, body) {
  if (body?.encrypt) {
    if (!env.LARK_ENCRYPT_KEY) throw new Error("收到加密事件但未配置 LARK_ENCRYPT_KEY");
    return decryptEvent(env.LARK_ENCRYPT_KEY, body.encrypt);
  }
  return body;
}

// ---------------------------------------------------------------------------
// 事件取值
// ---------------------------------------------------------------------------

/**
 * 从消息事件里取纯文本。
 *
 * 两层解包：`event.message.content` 本身是 JSON 字符串，解开才是 `{"text":"..."}`。
 * 群里 @机器人 时文本里会留下 `@_user_1` 这样的占位符，要剥掉——否则命令解析会把
 * 它当成参数的一部分（`/金句 @_user_1 内容`）。
 */
export function messageText(event) {
  const msg = event?.event?.message;
  if (!msg || msg.message_type !== "text") return "";
  let text = "";
  try {
    text = JSON.parse(msg.content || "{}").text || "";
  } catch {
    return "";
  }
  return text.replace(/@_user_\d+/g, "").replace(/\s+/g, " ").trim();
}

export const chatIdOf = (event) => event?.event?.message?.chat_id || "";
export const senderOf = (event) => event?.event?.sender?.sender_id?.open_id || "";
export const eventIdOf = (event) => event?.header?.event_id || "";
export const eventTypeOf = (event) => event?.header?.event_type || "";

export function isLarkEnabled(env) {
  return Boolean(env.LARK_APP_ID && env.LARK_APP_SECRET);
}
