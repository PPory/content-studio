/**
 * 「点叉号 = 应用真的关掉了」这条行为的测试。跑法：node tests/auto-exit.mjs
 *
 * 它守的是两个方向，缺一个都会变成新故障：
 *
 *  - 关窗要**真的退**。不退的话用户以为关了，机器上却攒着一个看不见的常驻进程。
 *  - 刷新**绝对不能退**。刷新和关窗在断开那一刻长得一模一样，靠的是「宽限期内有没有
 *    人接回来」区分。这条要是错了，症状是刷新一下应用自己没了——比不退难查得多。
 *
 * 不开浏览器，直接拿 Node 22 内置的 WebSocket 冒充 vite 的 HMR 客户端：这个机制
 * 本来就只看 ws 连接数，开一个 Chromium 只是把同一件事包了一层，还慢十倍。
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SELF = fileURLToPath(import.meta.url);
const PORT = 5198; // 避开 dev server 的 5180 和冒烟测试的 5199

// ── 子进程模式：起一个装了 auto-exit 的 dev server，然后等它自己决定什么时候死
if (process.argv.includes("--serve")) {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, "vite.config.mjs"),
    server: { port: PORT, strictPort: true, open: false },
    logLevel: "error",
  });
  await server.listen();
  // 这里不能 process.exit——整个测试就是在等它自己退
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function portUp() {
  return new Promise((resolve) => {
    const s = net.connect(PORT, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
    setTimeout(() => (s.destroy(), resolve(false)), 400);
  });
}

/** 冒充一个 vite HMR 客户端。子协议必须是 vite-hmr，否则握手不成立。 */
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`, "vite-hmr");
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("HMR 连不上")), { once: true });
  });
}

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass, detail });
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-auto-exit-"));
  const child = spawn(process.execPath, [SELF, "--serve"], {
    cwd: ROOT,
    // 只有启动器起的那次才装 auto-exit，所以测试必须自己把这面旗举起来
    env: { ...process.env, WB_LAUNCHER: "1", XENHO_HOME: path.join(tempRoot, "Xenho") },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let alive = true;
  let childErr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (d) => (childErr += d));
  child.on("exit", () => (alive = false));

  try {
    for (let i = 0; i < 150 && !(await portUp()); i++) await sleep(200);
    if (!(await portUp())) throw new Error("dev server 没起来" + (childErr ? "：" + childErr.slice(0, 200) : ""));

    // ① 有客户端连着的时候不能退
    const first = await connect();
    await sleep(1500);
    check("有窗口开着时不退", alive);

    // ② 刷新：断开后立刻接回来，宽限期到点时应该已经被取消
    first.close();
    await sleep(300);
    const second = await connect();
    await sleep(6000); // 宽限期是 4 秒，等超它
    check("刷新页面不会把服务带走", alive);

    // ③ 关窗：断开之后没人接，宽限期一到就退
    second.close();
    for (let i = 0; i < 60 && alive; i++) await sleep(200);
    check("关掉窗口后 dev server 自己退出", !alive);
  } catch (e) {
    check("测试跑完", false, e.message);
  } finally {
    if (alive) child.kill();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  const bad = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(` ${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? `  ← ${c.detail}` : ""}`);
  console.log(`
 ${checks.length - bad.length}/${checks.length} 通过`);
  process.exit(bad.length ? 1 : 0);
}

// **调用排在最后**：`main()` 里要用到上面那个 `const checks`，而 const 不像函数声明那样提升，
// 写在文件顶上会直接抛 TDZ。
if (!process.argv.includes("--serve")) await main();
