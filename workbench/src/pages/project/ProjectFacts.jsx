// 右栏上半：这一篇的**事实**——阶段、下一步、简报三项、更新时间。
//
// ⚠️ **这些是「关于它的」，不是「它本身」**，所以在右栏而不是左栏。
// 上一版把它们摆在正文左边（245px 一条），于是每次要读自己写的字，眼睛得先越过
// 一整栏元信息。四张参考图（Snappy / 病历模板 / 两个项目详情）在这一点上一致：
// **中间是你动手的东西，右边是关于它的事实**。
//
// ⚠️ **标题不在这儿。** 上一版这里有个 `<h1>{project.title}</h1>`，而正文那一栏
// 顶上还有一个可编辑的标题输入框、顶栏面包屑里又是一遍——**同一句话一屏三份**，
// 其中两份还不能改。留下的是能改的那一份。

import { relTime } from "../../components/ui.jsx";
import { IconAlertTriangle } from "../../components/icons.jsx";

/**
 * ⚠️ **「尚未填写」和「填了但是空的」要分开说。**
 * 简报三项是创作的前提，缺哪一项就是缺一个具体的下一步；
 * 一律写「—」的话，这一栏看起来只是排版留白，不像在等你补。
 */
function Row({ label, value, empty = "尚未填写" }) {
  const has = value != null && String(value).trim() !== "";
  return (
    <div className="pfacts__row">
      <dt>{label}</dt>
      <dd data-empty={has ? undefined : ""}>{has ? value : empty}</dd>
    </div>
  );
}

export function ProjectFacts({ project, onReturn, onSetPrimary, busy }) {
  const blockers = Array.isArray(project.blockers) ? project.blockers : [];
  const variants = project.variants || [];
  const canReturn = typeof onReturn === "function";

  return (
    <section className="pfacts" aria-label="项目简报">
      {/**
        * ⚠️ **这儿不再画一遍阶段和进度。**
        * 上一版这一栏顶上是「阶段 pill + 进度条」，而顶栏那颗 pill 说的是同一件事、
        * 正上方那条七段流程线说的还是同一件事——**一屏三份**。
        * 留下流程线那一份：只有它同时答了「走到哪儿了」和「还剩几段」，
        * 另外两份是它的子集。这一栏从**为什么在这一档**开始说，那是流程线答不了的。
        */}
      {project.stageReason ? <p className="pfacts__why">{project.stageReason}</p> : null}

      {/* ⚠️ **阻塞排在简报前面**：它就是此刻拦着这一篇的那件事，
          排在三行元信息后面的话，要往下读四行才看得到 */}
      {blockers.length ? (
        <div className="pfacts__warn" role="status">
          <IconAlertTriangle aria-hidden="true" stroke={1.8} />
          <div>{blockers.map((item) => <p key={item}>{item}</p>)}</div>
        </div>
      ) : null}

      <dl className="pfacts__list">
        <Row label="下一步" value={project.nextAction} empty="等流水线" />
        <Row label="目标读者" value={project.brief?.audience} />
        <Row label="核心观点" value={project.brief?.viewpoint} />
        <Row label="主平台" value={project.brief?.platform} empty="尚未选择" />
        <Row label="更新" value={project.updatedAt ? relTime(project.updatedAt) : ""} empty="—" />
      </dl>

      {/**
        * ⚠️ **「退回写作」是这一页唯一的后退键，不能藏。**
        * 它只在稿子已经锁住的两档出现（待诊断 / 待发布）——那时候正文是只读的，
        * 没有它，发现一处错字就只剩「重新走一遍流程」这一条路。
        */}
      {canReturn ? (
        <button type="button" className="pfacts__return" onClick={onReturn} disabled={busy}>退回写作修改</button>
      ) : null}

      {variants.length && project.stage !== "待发布" ? (
        <div className="pfacts__variants">
          <b>{project.masterDraft ? "内容变体" : "请选择母版"}</b>
          {variants.map((item) => (
            <span key={item.id}>
              {item.platform} · {item.title}
              {!project.masterDraft ? <button type="button" onClick={() => onSetPrimary(item.id)}>设为母版</button> : null}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
