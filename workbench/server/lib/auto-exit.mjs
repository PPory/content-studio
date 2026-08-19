// 窗口关掉之后，dev server 自己退干净。**只在开始菜单那个图标起的那次生效。**
//
// 为什么需要它：这东西是当桌面应用用的，而 Chrome 的 `--app` 窗口点叉号**只关窗口**。
// 后面那个 `node vite` 是 `scripts/launch.ps1` 用 `-WindowStyle Hidden` 起的——没有窗口、
// 没有托盘图标、任务栏上也看不到。用户以为自己关了应用，实际上留了一个常驻进程，
// 而唯一的收尾办法（`npm run app:stop`）藏在 package.json 里，没有任何界面提到过它。
// 每天点一次图标就多攒一个，直到重启机器。
//
// ## 为什么不是「页面 beforeunload 发一个 /api/quit」
//
// **刷新页面也会触发 beforeunload**，而在那一刻，刷新和关窗长得一模一样。
// 唯一能区分的信号是「过一会儿还有没有人连回来」——那正是 HMR 的 WebSocket
// 已经在做的事，不必自己再造一套心跳，也就不会有「心跳漏了一拍就误杀」的新故障。
//
// 判据因此是：**最后一个 HMR 客户端断开，宽限期内没人接上，就退。**
// 刷新时 vite 的客户端会在几十毫秒内重连，退出计时被取消，用户什么都感觉不到。
//
// ## 三条不能省的闸
//
//  1. **只认 `WB_LAUNCHER`**。终端里 `npm run dev` 时绝不能退——开发时关掉一个浏览器
//     标签页就把服务带走，是在制造一个比原问题更烦的新问题。
//  2. **连过一次才武装**。服务刚起来时客户端数天然是 0，不设这条的话它会在浏览器
//     还没打开之前就把自己关掉（`launch.ps1 -NoBrowser` 那条路更是必然踩中）。
//  3. **有活在跑就不退**。洞察周报 spawn 的是一个要跑几分钟的 `claude` 子进程，
//     它不跟着某个请求走。关窗就把它杀掉的话，用户回来只会看到一次没有任何解释的失败。
//     对话通道不用管——那个子进程绑在请求上，`res.on("close")` 已经会杀它。

import { isInsightRunActive } from "./insight-run.mjs";

// 刷新一次的重连是毫秒级的，4 秒足够把「刷新」和「关窗」分开；
// 再长的话，关窗后进程还赖在那儿的时间就开始能被感知了。
const GRACE_MS = 4000;

/**
 * @param {import("vite").ViteDevServer} server
 * @param {(msg: string) => void} [log] 说一句为什么退了。日志被 launch.ps1 重定向进
 *   `tmp/dev-server.log`，是这件事唯一的痕迹——没有它，进程消失了没人查得出原因。
 */
export function installAutoExit(server, log = (m) => console.log(m)) {
  // 终端起的、或者显式要求常驻的（比如以后真做开机自启），一律不装
  if (!process.env.WB_LAUNCHER || process.env.WB_KEEP_ALIVE) return;

  let armed = false;   // 有人连过了吗（见闸 2）
  let timer = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const quit = async () => {
    timer = null;
    // 到点了再确认一次：这中间可能有人连回来，也可能刚起了一轮洞察
    if (server.ws.clients.size > 0) return;
    if (isInsightRunActive()) {
      log("[auto-exit] 洞察周报还在跑，先不退；跑完再看");
      timer = setTimeout(quit, GRACE_MS);
      return;
    }
    log("[auto-exit] 窗口已关闭，退出 dev server");
    // 先让 Vite 自己收尾（关 ws、关 http、跑插件的 close 钩子），卡住就硬退——
    // 用户已经看不到这个进程了，不能让它以「正在优雅关闭」的名义继续留着。
    const hard = setTimeout(() => process.exit(0), 2000);
    hard.unref?.();
    try {
      await server.close();
    } catch {}
    process.exit(0);
  };

  const check = () => {
    if (!armed || server.ws.clients.size > 0) return cancel();
    cancel();
    timer = setTimeout(quit, GRACE_MS);
  };

  server.ws.on("connection", (socket) => {
    armed = true;
    cancel();
    // ws 的 close 先于 clients 集合更新，所以推到下一个 tick 再数
    socket.on("close", () => setImmediate(check));
  });
}
