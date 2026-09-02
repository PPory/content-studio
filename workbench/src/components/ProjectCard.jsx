// 一个内容项目的卡片。今日、内容、复盘三处共用。
//
// ⚠️ **从 `pages/Content.jsx` 搬到这儿来的。** 搬家的理由不是「文件太长」，是
// **依赖方向反了**：`Today.jsx` 原来 `import { ProjectCard } from "./Content.jsx"`
// ——页面 import 另一个页面，CLAUDE.md 明令禁止。后果不是马上坏，是「改内容页
// 会顺手改坏今日页」，而那种坏法没有任何地方会报出来。
//
// ⚠️ **卡片只给「要动手的少数」用**（一屏 ≤4 张），全集走列表行 / 表格。
// 判据写在 `docs/design-system.md`「什么时候用卡片，什么时候用条目」。
// 上一版这张卡是**全集**的显示形态（九个阶段各一条泳道、每条两列卡），
// 于是它 218px 高却只装了三四行字，中段大片留白——那正是「太乱」的来源之一。

import { StatePill, relTime } from "./ui.jsx";
import { IconAlertTriangle, IconArrowRight } from "./icons.jsx";
import { PROJECT_STAGE_META, PROJECT_STAGES, projectOpenTarget } from "../lib/content-projects.js";

/**
 * 一个项目走到哪儿了，0–1。
 *
 * ⚠️ **不新造一套算法**：直接用 `PROJECT_STAGE_META` 里那个 `index`
 *（`01 策划 → 07 完成`），那是 Worker 已经定好的阶段顺序，界面只负责把它画出来。
 * 自己按「简报齐没齐 / 有没有主稿 / 发没发」再算一遍的话，就成了第二份阶段判据，
 * 而这个项目的事故清一色是「同一件事写在两个地方」。
 *
 * ⚠️ **`已搁置` / `需处理` / `生成中` 返回 null**。它们不在那条线上：搁置是停下了、
 * 需处理是岔出去了。硬给一个百分比等于说「它还在正常往前走」，而那是假话。
 *
 * ⚠️ **眼下没有调用方**——卡片上那条进度撤了（理由写在 `act-card__foot` 上面）。
 * 留着这份实现是为了下次真要画进度时不再算第二遍，不是为了把它画回卡上。
 */
export function stageProgress(stage) {
  const n = Number(PROJECT_STAGE_META[stage]?.index);
  if (!Number.isFinite(n)) return null;   // index 是 "—" 或 "!" 的那几档
  const last = PROJECT_STAGES.map((s) => Number(PROJECT_STAGE_META[s]?.index)).filter(Number.isFinite).at(-1) || 7;
  return Math.max(0, Math.min(1, n / last));
}

export function ProjectCard({ project, onOpen }) {
  const canOpen = !!projectOpenTarget(project);
  const blockers = Array.isArray(project.blockers) ? project.blockers : [];
  const title = project.title || "未命名内容";
  const note = (project.stageReason || "").trim();

  return (
    /**
     * ⚠️ **外壳不是 button**：底部那颗「下一步」是真按钮，button 套 button 是非法结构。
     * 整卡点击留着——那是鼠标的便利，不需要 role 也成立。
     */
    <article
      className="act-card"
      data-stage={project.stage}
      onClick={canOpen ? onOpen : undefined}
    >
      {/**
        * ⚠️ **状态 · 现状 · 时间挤在同一行，「现状」不再单占一行。**
        * 这张卡原来是四行（状态 / 标题 / 现状 / 进度＋下一步），竖排三张就是半屏多；
        * 而那一行现状是一句短话，和 pill 并排完全放得下——**项目页顶栏那条
        * 「pill + 为什么在这一档」用的就是这个形状**，不是新造的。
        *
        * ⚠️ **原因和阻塞二选一，永远只画一条。**
        * 两者常常是同一句话（「缺少目标读者」既是卡住的原因、也是要解决的那件事），
        * 都画就是同一句话在一张卡上印两遍——一遍灰字一遍红字，看着像界面出了错。
        * 有阻塞时让阻塞说（它带着下一步），没有才退回原因。
        *
        * ⚠️ **阻塞退成一行红字，不再是一只红框。**
        * 那只框自带内边距和底色，一张卡为它高出三十多像素，而它装的只有五个字。
        * 红字 + 警告图标在一行灰字中间已经足够跳出来——**这仍是这张卡上唯一用红的地方**。
        */}
      <div className="act-card__top">
        <StatePill state={project.stage} />
        {blockers.length ? (
          <span className="act-card__warn" role="status" title={blockers[0]}>
            <IconAlertTriangle aria-hidden="true" stroke={1.8} />
            <span>{blockers[0]}</span>
          </span>
        ) : (
          <span className="act-card__note" title={note || undefined}>{note}</span>
        )}
        <time>{relTime(project.updatedAt)}</time>
      </div>

      <h3 className="act-card__title" title={title}>{title}</h3>

      {/**
        * 底部只剩一句「下一步」。
        *
        * ⚠️ **按钮上写的是 `nextAction` 本身，不是「去处理」。**
        * 「去处理」是个泛指，读完还得往左看一眼才知道要去干嘛；
        * 而「去排版发布」「继续写作」自己就说完了。按钮上的字要说清会发生什么。
        *
        * ⚠️ **同一行左边那条进度撤了，别加回来。**
        *
        * 它是 `stageProgress(project.stage)`，也就是 `阶段序号 / 7`——而阶段就写在
        * 这张卡左上角那颗 `StatePill` 上，两者是同一个事实的两种画法。
        * 实际长出来的样子是：三张卡并排，三条一模一样的 50%。一个每张卡上都相同、
        * 又能从旁边直接读出来的数字，占的是版面，给的是零信息。
        *
        * 更要紧的是它**会骗人**：进度画的是流程走到第几格，不是内容写了多少
        *（这句话 `content-projects.js` 里已经为详情页的七段流程线写过一遍，
        * 那条线因此被整个撤掉了——这条进度是同一个错误的最后一处残留）。
        * 一篇 0 字的空稿子照样显示 50%。
        *
        * `stageProgress()` 和 `Meter` 组件都留着：`Meter` 别处在用，
        * `stageProgress` 留一份实现，免得以后有人再算一遍。
        */}
      <div className="act-card__foot">
        {/**
          * ⚠️ **必须是一颗真 button，不能退成 `<span>` 靠整卡点击。**
          * 整卡 onClick 只是**鼠标**的便利；写成 span 的话键盘用户根本打不开这个项目，
          * 而屏幕上什么都看不出来。外壳仍然不是 button（button 套 button 非法结构）。
          */}
        <button
          type="button"
          className="act-card__go"
          disabled={!canOpen}
          aria-label={`${project.nextAction || "打开"}：${title}`}
          onClick={(e) => {
            e.stopPropagation();   // 不然整卡那一层会再触发一次
            onOpen?.();
          }}
        >
          {project.nextAction || "检查项目状态"}
          <IconArrowRight stroke={1.9} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
