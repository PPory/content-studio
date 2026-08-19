// 本地 API 的路由表。挂进 Vite dev server 的中间件链（见 vite-plugin-workbench.mjs）。

import crypto from "node:crypto";
import { json, fail, matchRoute } from "./lib/http.mjs";
import { pipeRoutes } from "./routes/pipe.mjs";
import { vaultRoutes } from "./routes/vault.mjs";
import { configRoutes } from "./routes/config.mjs";
import { settingsRoutes } from "./routes/settings.mjs";
import { promptsRoutes } from "./routes/prompts.mjs";
import { aiRoutes } from "./routes/ai.mjs";
import { hotRoutes } from "./routes/hot.mjs";
import { metricsRoutes } from "./routes/metrics.mjs";
import { postsRoutes } from "./routes/posts.mjs";
import { archiveRoutes } from "./routes/archive.mjs";
import { agentRoutes } from "./routes/agent.mjs";
import { translateRoutes } from "./routes/translate.mjs";
import { extensionRoutes } from "./routes/extension.mjs";
import { backupRoutes } from "./routes/backup.mjs";
import { searchRoutes } from "./routes/search.mjs";
import { insightsRoutes } from "./routes/insights.mjs";
import { planRoutes } from "./routes/plan.mjs";
import { audienceRoutes } from "./routes/audiences.mjs";
import { revisionRoutes } from "./routes/revisions.mjs";

const EXTENSION_ALIASES = {
  "/api/extension/intake": "/api/pipe/intake",
  "/api/extension/ask": "/api/ai/explain",
  "/api/extension/chat": "/api/agent/chat",
};

/**
 * 「地址是本机」不等于「请求来自工作台」。
 *
 * 这个 dev server 上挂着 vault 的读写口、D1 流水线写入口和本机 CLI 通道，而**任何
 * 网页**都能往 `http://127.0.0.1:5180/api/...` 发跨站 POST——浏览器会照发不误，
 * 只是不让那个页面读到响应。对「删一本书」「改一篇稿」这种写操作来说，读不到响应
 * 一点都不重要，写进去了就已经完成了。
 *
 * 两道检查，都只针对**会改东西**的请求（GET/HEAD 不设防，它们本来就有同源策略挡着读）：
 *
 *  1. `Origin` 对不上就拒。浏览器发跨站 POST 时**一定**带 Origin，所以这条足够挡住
 *     网页发起的伪造请求。**Origin 缺失时放行**是有意的：node 脚本、curl、测试都不带
 *     这个头，而它们本来就不是浏览器、不存在「用户在别的网站上被顺手代表了」这回事。
 *  2. `Host` 必须是回环地址。挡的是 DNS rebinding：把一个域名解析到 127.0.0.1，
 *     那个域名下的页面就变成了「同源」，第 1 条会被绕过。
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\]|::1)(?::\d+)?$/i;

function originAllowed(origin, host) {
  if (!origin) return true; // 非浏览器客户端（node 脚本 / curl / 自检）
  if (origin.startsWith("chrome-extension://")) return true; // 扩展那条链另有令牌把关
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return LOOPBACK_HOST.test(u.host) && (!host || u.host === host);
  } catch {
    return false;
  }
}

export function requestAllowed(req) {
  if (SAFE_METHODS.has(req.method)) return true;
  const host = String(req.headers.host || "");
  if (host && !LOOPBACK_HOST.test(host)) return false;
  return originAllowed(String(req.headers.origin || ""), host);
}

const ROUTES = [
  ...configRoutes,
  ...settingsRoutes,
  ...promptsRoutes,
  ...pipeRoutes,
  ...vaultRoutes,
  ...aiRoutes,
  ...hotRoutes,
  ...metricsRoutes,
  ...postsRoutes,
  ...archiveRoutes,
  ...agentRoutes,
  ...translateRoutes,
  ...extensionRoutes,
  ...backupRoutes,
  ...searchRoutes,
  ...planRoutes,
  ...audienceRoutes,
  ...revisionRoutes,
  ...insightsRoutes,
];

export function createApi(env) {
  // 每次工作台启动生成一次配对令牌。网页拿不到带自定义请求头的响应，扩展拿到后只存在
  // chrome.storage.session；工作台重启时自动重新配对，不把任何长期密钥塞进扩展源码。
  const extensionToken = crypto.randomBytes(24).toString("base64url");
  return async function apiMiddleware(req, res, next) {
    if (!req.url?.startsWith("/api/")) return next();

    if (!requestAllowed(req)) {
      return json(
        res,
        {
          ok: false,
          error: "这个写请求不是从工作台发出来的",
          hint: "工作台只接受本机 127.0.0.1:5180 页面和 Xenho 扩展的写入。如果你是从脚本调用，去掉 Origin 请求头即可。",
        },
        403
      );
    }

    let url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/extension/")) {
      const marker = String(req.headers["x-xenho-extension"] || "");
      const origin = String(req.headers.origin || "");
      if (marker !== "1" || (origin && !origin.startsWith("chrome-extension://"))) {
        return json(res, { ok: false, error: "只接受 Xenho 浏览器扩展请求" }, 403);
      }
      if (url.pathname !== "/api/extension/status" && req.headers["x-xenho-token"] !== extensionToken) {
        return json(res, { ok: false, error: "扩展配对已失效，请重试" }, 401);
      }
      const alias = EXTENSION_ALIASES[url.pathname];
      if (alias) {
        const mapped = new URL(url);
        mapped.pathname = alias;
        url = mapped;
      }
    }
    const hit = matchRoute(ROUTES, req.method, url.pathname);
    if (!hit) return json(res, { ok: false, error: `未知端点 ${req.method} ${url.pathname}` }, 404);

    try {
      await hit.route.handler({ env, req, res, url, params: hit.params, extensionToken });
    } catch (e) {
      // 兜底：任何未捕获异常都回成统一契约，别让前端收到一坨 HTML 错误页
      console.error(`[api] ${req.method} ${url.pathname} failed:`, e);
      if (!res.headersSent) fail(res, e.message || "服务端异常");
    }
  };
}
