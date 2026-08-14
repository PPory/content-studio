# 当桌面应用用（开始菜单 / 任务栏）

`npm run app:install` 那一套的实现细节。**改 `scripts/launch.*` / `install-shortcut.ps1` / `make-icon.mjs` 之前先读这份**；
只改工作台前端和服务端的话，这里一条都用不上——所以从 `CLAUDE.md` 搬到这里。

---

`npm run app:install` 在开始菜单放一个「Xenho OS」，点它 = 确认服务在跑（不在就拉起来）+ 用 Chrome 的 **app 模式**开一个没有地址栏的窗口。任务栏独立图标、独立 Alt+Tab 项，用起来和别的应用没区别。装完在开始菜单搜「Xenho」，右键就能固定到任务栏。加 `-- -Desktop` 顺带放一份到桌面（默认不放：桌面有 tidy-desktop 自动归档，.lnk 迟早被扫走）；`-- -Uninstall` 删掉。除了那个 `.lnk`，**没写注册表、没装服务、没改系统设置**。

链路是 `.lnk → wscript → launch.vbs → powershell -Hidden → launch.ps1`。四层看着绕，每一层都在解决一个具体问题：

- **快捷方式指向 wscript 而不是 powershell**：指向 powershell 的话，即便带 `-WindowStyle Hidden` 也会闪一下黑窗——窗口是先创建再隐藏的。wscript 压根不创建。那一闪就是「这是个应用」和「这是别人拿脚本包了一层」的区别。
- **`launch.vbs` 必须是纯 ASCII**：wscript 按 ANSI 读 .vbs（除非存成 UTF-16），里面写中文就是乱码。
- **三个 `.ps1` 必须存成 UTF-8 **带 BOM**：powershell 5.1 不带 BOM 会把中文读成乱码。用 Write 工具改完这几个文件，**记得转一次编码**，否则界面上的提示全是问号。
- ⚠️ **主流程整个包在 `try` 里**。脚本是隐藏跑的，**没有控制台**，任何未捕获的异常都纯静默：点了图标什么都不发生，日志里也没有。踩过一次（见下条），查了两轮才想到去前台跑一遍 `powershell -File scripts/launch.ps1`——**这是排查这条链路的唯一办法**。
- **冷启动必须有启动画面**（`New-Splash`，黑底 + logo + 一行状态）。从点图标到界面出来有 2~10 秒，这段时间屏幕上什么都不变，人的反应一定是再点一次——于是起第二个进程抢同一个端口，`strictPort` 让它直接挂掉。启动画面不是装饰，是**挡住那个会把事情弄坏的动作**。超过 12 秒改口说「首次启动要预打包依赖」。
- **WinForms 用到才 `Add-Type`**：加载那两个程序集要将近一秒，而最常走的那条路（服务已在跑，直接开窗口）一个窗体都不用画。
- **dev server 的 stdout 重定向到文件，不用 .NET 管道**：Vite 每次热更新都写日志，管道没人读、满了就把服务卡死。日志在 `tmp/dev-server.log` / `.err.log`。
- **`WB_LAUNCHER=1` 让 `vite.config.mjs` 关掉 `open`**：不关的话它自己再弹一个普通浏览器标签，加上 app 窗口就是同一个工作台开两遍。手敲 `npm run dev` 时照旧自动打开。
- **窗口用 `--start-maximized` 直接铺满**，不再配 `--window-size`：两个一起给的时候尺寸会赢，窗口反而不是最大化的。开完还要人点一下最大化，就等于每次启动多一步。
- **端口从 `vite.config.mjs` 正则读出来**，不在 launcher 里抄第二份——`strictPort` 下抄错就是起不来。
- `app:stop` 只杀**命令行里同时含项目路径和 vite** 的 node 进程。按进程名杀会把这台机器上别的项目一起带走。

### 图标是现场光栅化的（`scripts/make-icon.mjs`）

从 `02--Resources/04--设计素材/logo-X字母黑底白色-20260812.svg` 生成 `scripts/xenho-os.ico`（生成物，跟着 `app:install` 自动跑）。自己画不引包：形状是**一个圆和一个方块的并集**（三圆角 + 右下直角），X 是**一条曲线都没有的多边形**（原 SVG 里全是 `L`），两样都是十几行数学，为它引一个带原生依赖的光栅化库，装的时间比画的时间长。颜色和 `index.html` 的 favicon 一致（`#111318` + 纯白 X）——任务栏和浏览器标签页都没有主题 token，这里就是写死的黑底白字。

⚠️ **不能所有尺寸都塞 PNG。** Explorer 从 Vista 起就认 PNG 帧，但 **.NET 的 `System.Drawing.Icon` 到今天都不认**——`new Icon(path, 64, 64).ToBitmap()` 会抛「Requested range extends past the end of the array」。启动画面要显示这个图标，第一版全 PNG，现象就是上面那条「点了没反应」。所以按常规布局来：**≤64 用 BMP（DIB，谁都认），128/256 用 PNG**（BMP 到 256 就是 256KB 一张）。BMP 帧要注意两点：高度字段写**两倍**（XOR 位图 + AND 掩码）、像素**自下而上**。启动画面另有一张 `xenho-os-64.png`，WinForms 直接 `Image.FromFile` 更省事。

