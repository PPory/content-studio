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

function dispatcherFor(url) {
  // 本机地址不走代理，否则把 WORKER_URL 指向 wrangler dev 时会连不上
  const host = new URL(url).hostname;
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (host === "localhost" || host === "127.0.0.1" || noProxy.includes(host)) return undefined;

  if (cached === undefined) {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || "";
    cached = proxy ? new ProxyAgent(proxy) : null;
  }
  return cached || undefined;
}

export function proxyFetch(url, options = {}) {
  return undiciFetch(url, { ...options, dispatcher: dispatcherFor(url) });
}
