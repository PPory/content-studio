/**
 * 收起后留在原地的那一颗。
 *
 * **它不是第二个 AI 入口。** 顶栏那颗 AI 键（`Ctrl+I`）一直在，而且是按当前页面路由的；
 * 再挂一颗常驻浮标就是给一扇已有的门再修一扇门。
 *
 * 这颗只在一种情况下出现：**本屏本来有一列 AI，而它现在收着。**
 * 我们的项目页收起协作栏是「整列消失」——那片区域于是没有任何东西标着「这儿本来有 AI」，
 * 想要回来得抬头去顶栏找。浮标解决的是这个：**收起和展开成为同一处的两个状态**，
 * 而不是「消失了，去别处找」。栏开着时它不画。
 *
 * 阅读页不用它：那儿顶栏已经有一颗右栏开关，再加就重复了。
 */
import { IconSparkles } from "../icons.jsx";

export function AssistantOrb({ label, shortcut = "Ctrl+I", onOpen }) {
  return (
    <div className="assistant-orb">
      {/**
        * 说明**指到才出现**（hover 或键盘聚焦，见 CSS）。常驻的话这行字一直浮在正文
        * 右下角——它是给第一次见到这个圆圈的人看的，之后每一屏正文都要绕开它。
        *
        * 它不是无障碍名字：读屏用的是按钮上的 `aria-label`，所以这段标 `aria-hidden`，
        * 免得同一句话被念两遍。
        */}
      <span className="assistant-orb__label" aria-hidden="true">{label}<kbd>{shortcut}</kbd></span>
      <button
        type="button"
        className="assistant-orb__button"
        onClick={onOpen}
        aria-label={`${label}（${shortcut}）`}
      >
        <IconSparkles aria-hidden="true" stroke={1.7} />
      </button>
    </div>
  );
}
