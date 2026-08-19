// 把本地 API 挂进 Vite dev server 的中间件链，而不是另起一个进程 + 配代理。
// 一个进程、一条 npm run dev、没有端口对不上的问题，也不需要 concurrently 这类依赖。
//
// 代价是 API 只在 dev 模式下存在。这是有意的：工作台是本地工具，永远跑 dev，
// `npm run build` 只用来验证前端能编译过。

import { createApi } from "./api.mjs";
import { installAutoExit } from "./lib/auto-exit.mjs";
import { serveTypeset } from "./routes/tools.mjs";

export function workbenchApi(env) {
  return {
    name: "creator-workbench-api",
    configureServer(server) {
      // 放在最前面：/api/* 和 /tools/* 由我们接管，其余交回 Vite
      server.middlewares.use(createApi(env));
      // 公众号排版工具静态托管。放在 Vite 之前，否则会被它的 SPA 回退吃掉
      server.middlewares.use(serveTypeset(env));
      // 当桌面应用用的那次：关掉窗口就把这个进程也收掉（终端 npm run dev 不受影响）
      installAutoExit(server);
    },
  };
}
