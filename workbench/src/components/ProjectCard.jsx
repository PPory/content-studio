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

import { StatePill, Meter, relTime } from "./ui.jsx";
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
 * ⚠️ **`已搁置` / `需处理` / `生成中` 返回 null，整条进度不画**（`Meter` 收到 null 就不渲染）。
 * 它们不在那条线上：搁置是停下了、需处理是岔出去了。硬给一个百分比等于说
 * 「它还在正常往前走」，而那是假话。
 */
export function stageProgress(stage) {
  const n = Number(PROJECT_STAGE_META[stage]?.index);
  if (!Number.isFinite(n)) return null;   // index 是 "—" 或 "!" 的那几档
  const last = PROJECT_STAGES.map((s) => Number(PROJECT_STAGE_META[s]?.index)).filter(Number.isFinite).at(-1) || 7;
  return Math.max(0, Math.min(1, n / last));
}

export function ProjectCard({ project, onOpen, lead = false }) {
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
      data-lead={lead ? "" : undefined}
      data-stage={project.stage}
      onClick={canOpen ? onOpen : undefined}
    >
      <div className="act-card__top">
        <StatePill state={project.stage} />
        <time>{relTime(project.updatedAt)}</time>
      </div>

      <h3 className="act-card__title" title={title}>{title}</h3>

      {/**
        * ⚠️ 没有 stageReason 也要占高（`.act-card__note` 有 min-height），
        * 不占的话一排卡片里下面每一行都落在不同高度，扫的时候眼睛得上下找。
        *
        * ⚠️ **但它和下面那条阻塞常常是同一句话**（「缺少目标读者」既是卡住的原因、
        * 也是要解决的那件事），照直画就是同一句话在一张卡上印两遍——
        * 一遍灰字一遍红框，看着像界面出了什么错。重了就让阻塞那条说，它带下一步。
        */}
      <p className="act-card__note">{note === blockers[0] ? "" : note}</p>

      {/**
        * 阻塞：这张卡上**唯一**用红的地方。只显示第一条——
        * 卡片回答的是「要不要现在处理它」，不是「一共有几个问题」；
        * 全部阻塞在项目详情页的左栏里列着。
        */}
      {blockers.length ? (
        <div className="act-card__warn" role="status">
          <IconAlertTriangle aria-hidden="true" stroke={1.8} />
          <span>{blockers[0]}</span>
        </div>
      ) : null}

      {/**
        * ⚠️ **进度和动作合成一行，不再是一条出血的底栏。**
        * 上一版底部是「一道分隔线 + 一整条 48px 的动作区」，而它装的只有一句
        * 「下一步 · 去处理」——一张卡因此高出快五十像素，三张竖排就是一屏半。
        *
        * ⚠️ **按钮上写的是 `nextAction` 本身，不是「去处理」。**
        * 「去处理」是个泛指，读完还得往左看一眼才知道要去干嘛；
        * 而「去排版发布」「继续写作」自己就说完了。按钮上的字要说清会发生什么。
        */}
      <div className="act-card__foot">
        <Meter value={blockers.length ? null : stageProgress(project.stage)} label={`${title} 的进度`} />
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
