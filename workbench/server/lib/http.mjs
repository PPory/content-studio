// API 的响应契约与路由工具。
//
// 契约：所有端点一律返回 JSON，成功 { ok:true, ... }，失败 { ok:false, error, hint? }。
// hint 是给用户看的下一步动作（「在 .env 里填 WORKER_URL」），不是给开发者看的堆栈——
// 界面直接把 hint 显示出来，用户不用回来看日志就知道该干什么。

export function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

export function fail(res, error, { status = 500, hint } = {}) {
  json(res, { ok: false, error: String(error), ...(hint ? { hint } : {}) }, status);
}

export async function readJsonBody(req, limitBytes = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

/**
 * 原始字节请求体（导入书籍用）。
 *
 * 不走 multipart：只有一个文件、文件名和书名用 query 传就够了，为此引一个
 * multipart 解析器（或自己写一个）纯属白花力气。上限给到 120MB——
 * 带插图的 epub 十几 MB，扫描版 pdf 上百 MB，超了照实报错别静默截断。
 */
export async function readRawBody(req, limitBytes = 120_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw Object.assign(new Error(`文件超过 ${Math.round(limitBytes / 1e6)}MB`), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// 极简路由匹配：支持 /api/pipe/page/:id 这种命名段。
// 没引路由库是因为总共十来条路由，一个 40 行的匹配器比一个依赖更好维护。
export function matchRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

function matchPath(pattern, pathname) {
  const pa = pattern.split("/");
  const pb = pathname.split("/");
  if (pa.length !== pb.length) return null;
  const params = {};
  for (let i = 0; i < pa.length; i++) {
    if (pa[i].startsWith(":")) {
      if (!pb[i]) return null;
      params[pa[i].slice(1)] = decodeURIComponent(pb[i]);
    } else if (pa[i] !== pb[i]) {
      return null;
    }
  }
  return params;
}
