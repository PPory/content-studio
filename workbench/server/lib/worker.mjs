// 调 content-pipeline Worker 的唯一出口。JSON 调用和流式调用共用同一套地址/密钥/代理处理，
// 免得两处各写一遍、各漏一半错误分支。

import { proxyFetch } from "./fetch.mjs";

const TIMEOUT_MS = 30_000; // status 要拉全库计数，Notion 慢的时候十几秒是常态

// 未配置时返回的引导，走和其他错误一样的 { ok:false, error, hint } 契约
function notConfigured(env) {
  if (!(env.WORKER_URL || "").trim()) {
    return {
      ok: false,
      error: "未配置 WORKER_URL",
      hint: "在 creator-workbench/.env 里填 content-pipeline 的 Worker 地址",
    };
  }
  if (!(env.WORKBENCH_KEY || "").trim()) {
    return {
      ok: false,
      error: "未配置 WORKBENCH_KEY",
      hint: "先 npx wrangler secret put WORKBENCH_KEY 部署 Worker，再把同一串填进 .env",
    };
  }
  return null;
}

/** 原始调用：返回 fetch 的 Response，调用方自己决定怎么读（流式用这个） */
export async function callWorkerRaw(env, path, { method = "GET", body, search, timeoutMs = TIMEOUT_MS } = {}) {
  const miss = notConfigured(env);
  if (miss) return { configError: miss };

  const base = env.WORKER_URL.trim().replace(/\/+$/, "");
  const url = `${base}/wb/${path}${search ? `?${search}` : ""}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await proxyFetch(url, {
      method,
      headers: {
        "X-Workbench-Key": env.WORKBENCH_KEY.trim(),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    return { res, done: () => clearTimeout(timer) };
  } catch (e) {
    clearTimeout(timer);
    const aborted = e.name === "AbortError";
    return {
      configError: {
        ok: false,
        error: aborted ? `Worker 超过 ${Math.round(timeoutMs / 1000)} 秒没响应` : `连不上 Worker：${e.message}`,
        hint: aborted ? "Notion 或 LLM 可能正在慢查询，稍后重试" : "检查网络和 .env 里的 WORKER_URL",
      },
    };
  }
}

/** JSON 调用：把 Worker 的响应原样透传成 { status, data } */
export async function callWorker(env, path, options = {}) {
  const { res, configError, done } = await callWorkerRaw(env, path, options);
  if (configError) return { status: 503, data: configError };
  try {
    const text = await res.text();
    try {
      return { status: res.status, data: JSON.parse(text) };
    } catch {
      // Worker 没部署 /wb 时会返回 "content-pipeline is running" 这类纯文本；
      // 部署了但抛了未捕获异常时会返回 Cloudflare 的 1101 错误页（也是非 JSON）
      return {
        status: 502,
        data: {
          ok: false,
          error: `Worker 返回了非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`,
          hint: "在 content-pipeline 里跑 npx wrangler deploy；已部署的话用 npx wrangler tail 看真实报错",
        },
      };
    }
  } finally {
    done?.();
  }
}
