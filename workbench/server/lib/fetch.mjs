// 走代理的 fetch。
//
// 为什么不能直接用全局 fetch：这台机器设了 HTTPS_PROXY，而 Node 22 的原生 fetch
// **不认** HTTP(S)_PROXY 环境变量（内置支持是 Node 24 的 NODE_USE_ENV_PROXY 才有的）。
// 现象很误导——curl 同一个地址 200，Node 里却是一句没有任何细节的 `fetch failed`。
//
// 所以显式用 undici 的 fetch + ProxyAgent。undici 就是 Node 原生 fetch 的底层实现，
// 不是额外引入一套网络栈。

import { fetch as undiciFetch, ProxyAgent } from "undici";

let cached;

/** 这个地址是不是本机（本机永远直连，否则把 WORKER_URL 指向 wrangler dev 时会连不上） */
function isDirect(url) {
  const host = new URL(url).hostname.toLowerCase();
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return host === "localhost" || host === "127.0.0.1" || noProxy.includes(host);
}

/**
 * 这次请求实际会怎么出去。**给错误提示用的**——连不上时，「有没有走代理」几乎总是
 * 比「WORKER_URL 是不是写错了」更接近真相，而这件事光看报错完全看不出来。
 *
 * `via` 为空串表示直连；`local` 表示目标就在本机（那直连是对的，别提代理）。
 */
export function proxyInfo(url) {
  const local = isDirect(url);
  const via = local ? "" : process.env.HTTPS_PROXY || process.env.https_proxy || "";
  return { via, local };
}

function dispatcherFor(url) {
  if (isDirect(url)) return undefined;

  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || "";
  if (!proxy) return undefined;
  if (!cached || cached.url !== proxy) {
    cached?.dispatcher?.close?.().catch(() => {});
    cached = { url: proxy, dispatcher: new ProxyAgent(proxy) };
  }
  return cached.dispatcher;
}

export function proxyFetch(url, options = {}) {
  return undiciFetch(url, { ...options, dispatcher: dispatcherFor(url) });
}
