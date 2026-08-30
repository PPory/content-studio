import { createRoot } from "react-dom/client";
// 字体自带（@fontsource），不走 Google Fonts CDN——那条链路在国内网络下经常几秒才回来，
// 首屏会先闪一遍系统字体再跳字。只引实际用到的字重。
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-500.css";
import "@fontsource/noto-sans-sc/chinese-simplified-600.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

/**
 * 正文可选字体。**只引拉丁字重 400/500/600**——这几个包本身就只有拉丁字形，
 * 中文会落到系统字体上（见 ReadingPrefs 的字体栈），所以不用也不该引它们的全字符集。
 *
 * 为什么不引 Bookerly：那是亚马逊的专有字体，没有可分发的版本。Georgia 走系统自带，
 * Windows 和 macOS 都有，不用引包。
 */
import "@fontsource/literata/400.css";
import "@fontsource/literata/500.css";
import "@fontsource/literata/600.css";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/500.css";
import "@fontsource/lexend/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/500.css";
import "@fontsource/source-sans-3/600.css";
import { App } from "./App.jsx";
import "./styles.css";

// **在 render 之前**：挂载之后再改 localStorage 的话，第一帧读到的是旧数据，
// 屏幕上会先闪一次「还没有阅读记录」。

createRoot(document.getElementById("root")).render(<App />);
