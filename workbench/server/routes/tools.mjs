// /tools/* → 把工作区里已有的独立工具挂进工作台。
//
// wechat-typeset 是个零构建的本地 HTML 工具（双击 index.html 就能用）。工作台里点链接
// 打不开 file:// —— 浏览器禁止从 http 页面跳本地文件。所以由本地服务把它**静态托管**出来，
// 变成 http://127.0.0.1:5180/tools/typeset/ 。
//
// 这样做的另一个好处：typeset 项目本身一行都不用改，它仍然可以双击打开独立使用。

import path from "node:path";
import fs from "node:fs";
import { fail } from "../lib/http.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

// 默认按工作区约定找同级目录；装到别处就用 .env 的 TYPESET_DIR 指路径
export function typesetDir(env) {
  const custom = (env.TYPESET_DIR || "").trim();
  if (custom) return path.resolve(custom);
  // ⚠️ **两个点，不是一个。** workbench 现在住在 content-studio/ 里面，
  // 而 wechat-typeset 是 content-studio 的同级，所以要往上翻两层。
  // 合仓之前这里是 `..`——那一版在合仓当天就静默失效了：目录找不到，
  // 「排版」页显示 404 引导，看起来像是 typeset 没装。
  return path.resolve(process.cwd(), "..", "..", "wechat-typeset");
}

export function serveTypeset(env) {
  const root = typesetDir(env);

  return function typesetMiddleware(req, res, next) {
    if (!req.url?.startsWith("/tools/typeset")) return next();

    if (!fs.existsSync(root)) {
      return fail(res, "找不到 wechat-typeset 目录", {
        status: 404,
        hint: `期望在 ${root}；装在别处就在 .env 里设 TYPESET_DIR`,
      });
    }

    const rel = decodeURIComponent(req.url.replace(/^\/tools\/typeset\/?/, "").split("?")[0]) || "index.html";
    const abs = path.resolve(root, rel);
    // 越界防护和 vault 那边同一个道理：rel 来自 URL，`../../..` 能读到整台机器
    if (path.relative(root, abs).startsWith("..") || path.isAbsolute(path.relative(root, abs))) {
      return fail(res, "路径越界，拒绝访问", { status: 400 });
    }

    const file = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? path.join(abs, "index.html") : abs;
    if (!fs.existsSync(file)) return fail(res, `没有这个文件：${rel}`, { status: 404 });

    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  };
}
