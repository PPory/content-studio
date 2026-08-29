import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { workbenchApi } from "./server/vite-plugin-workbench.mjs";

export default defineConfig(({ mode }) => {
  // 第三个参数传 "" 才会读到不带 VITE_ 前缀的变量。这些变量只在 Node 侧用（插件里），
  // 绝不能进 define/import.meta.env——里面有 Worker key 和 LLM key，进前端就是泄露。
  const env = loadEnv(mode, process.cwd(), "");
  // 持久化测试通过进程变量指定系统临时工作区；它必须高于本机 .env 的真实工作区。
  if (process.env.XENHO_HOME) env.XENHO_HOME = process.env.XENHO_HOME;
  // 快照保留天数是唯一一个搬进 process.env 的变量：它被 `posts.mjs` 这类库函数用到，
  // 而那些函数没有（也不该有）env 参数。**只搬这一个**——密钥一律留在 env 对象里，
  // 经插件传给路由，别顺手把整份 env 铺进 process.env。
  if (env.SNAPSHOT_KEEP_DAYS) process.env.SNAPSHOT_KEEP_DAYS = env.SNAPSHOT_KEEP_DAYS;

  return {
    plugins: [react(), workbenchApi(env)],
    server: {
      // 只监听回环地址：工作台带着密钥、无鉴权，绝不能暴露到局域网
      host: "127.0.0.1",
      port: 5180,
      strictPort: true,
      // 从开始菜单那个图标启动时不要自己弹浏览器：launcher 会用 Chrome 的 app 模式开一个
      // 无地址栏窗口，两边都开就是同一个工作台开两遍。手敲 npm run dev 时照旧自动打开。
      open: !process.env.WB_LAUNCHER,
    },
  };
});
