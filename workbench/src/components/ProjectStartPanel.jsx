/**
 * 开写之前那一步：先搭结构，再起稿。
 *
 * ⚠️ **建了项目不自动生成全文。** 一上来给一篇完整的稿，人会本能地去改它，
 * 而不是先想自己要讲什么——而那篇稿是照着「一般文章该怎么写」生成的，
 * 不是照着这个人要留下的判断。所以这一屏只有一颗主动作：搭个结构。
 *
 * ⚠️ **它不问任何问题。** 真实问题、核心判断、选中的讲法、用到的材料，
 * 在内容机会里全都定过了；写作阶段再摆一个「你想写什么」的输入框，
 * 等于让用户把自己刚做完的判断再讲一遍。
 *
 * ⚠️ **正文只在用户点采纳时才动。** 结构和初稿都以候选进编辑器：
 * 结构落到光标处带底纹，初稿走整篇审阅。
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Note } from "./ui.jsx";
import { IconSparkles } from "./icons.jsx";
import "./project-start-panel.css";

export function ProjectStartPanel({ projectId, empty, needsDraft = false, busy: outerBusy = false, onInsert, onStartDraft, onActiveChange, onGo }) {
  const [context, setContext] = useState(undefined);
  const [outline, setOutline] = useState(null);
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  /** 「换一版，这样改」的那句话。搭结构和起稿共用一个输入框，按当前这一步发。 */
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.projectCreativeContext(projectId),
      // ⚠️ 搭一次要十几秒。刷一下页面就没，等于逼人再等一次十几秒。
      api.projectOutlineCandidate(projectId).catch(() => ({ outline: null, markdown: "" })),
    ])
      .then(([result, stored]) => {
        if (!alive) return;
        setContext(result.context);
        if (stored.outline) { setOutline(stored.outline); setMarkdown(stored.markdown || ""); }
      })
      // 没有关联内容机会的老项目走原来的写法，这一栏不出现。
      .catch(() => { if (alive) setContext(null); });
    return () => { alive = false; };
  }, [projectId]);

  const buildOutline = useCallback(async (ask = "") => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.projectOutline(projectId, ask);
      setOutline(result.outline);
      setMarkdown(result.markdown);
      setDraftNote("");
      setInstruction("");
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  /**
   * 正文要落进去之前，主稿得先存在。
   *
   * ⚠️ **不要让用户先去点一次「建立主稿」再回来。** 他刚认下一份结构，
   * 中间插一步「你还没有主稿」只是把系统自己的顺序摊给他看。
   */
  const ensureDraft = useCallback(async () => {
    if (!needsDraft) return true;
    return (await onStartDraft?.()) === true;
  }, [needsDraft, onStartDraft]);

  const buildDraft = useCallback(async (ask = "") => {
    if (!outline) return;
    if (!(await ensureDraft())) return;
    setDrafting(true);
    setError(null);
    try {
      const result = await api.projectDraftCandidate(projectId, outline, ask);
      setDraftNote(result.note || "");
      setInstruction("");
      // 整篇初稿走「整篇审阅」：它是正文的替换品，不是插在光标处的一段。
      onInsert?.({ text: result.body, scope: "document", resultKind: "candidate", title: result.title });
    } catch (failure) {
      setError(failure);
    } finally {
      setDrafting(false);
    }
  }, [outline, projectId, onInsert, ensureDraft]);

  const active = Boolean(context) && !dismissed && (empty || Boolean(outline));
  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);

  if (!active) return null;

  return (
    <section className="project-start" aria-labelledby="project-start-title">
      <header>
        <div>
          <span>还没开始写</span>
          <h2 id="project-start-title">先搭一个结构，再起稿</h2>
        </div>
        <div className="project-start__actions">
          {!outline ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => buildOutline()}>
              <IconSparkles aria-hidden="true" />
              {busy ? "正在搭…" : "基于这条构造，帮我搭一个结构"}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-sm" disabled={busy || drafting} onClick={() => buildOutline(instruction.trim())}>
                {busy ? "正在重搭…" : "重搭一个"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || drafting || outerBusy}
                onClick={async () => { if (!(await ensureDraft())) return; onInsert?.({ text: markdown }); api.forgetProjectOutline(projectId).catch(() => {}); setDismissed(true); }}
              >采用这个结构</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || drafting || outerBusy} onClick={() => buildDraft(instruction.trim())}>
                {drafting ? "正在起稿…" : draftNote ? "再起一版" : "照这个结构起稿"}
              </button>
            </>
          )}
          <button type="button" className="btn btn-sm" onClick={() => { api.forgetProjectOutline(projectId).catch(() => {}); setDismissed(true); }}>不用提纲，直接写</button>
        </div>
      </header>

      {/* 继承下来的意图。只读三行，不是让人再填一遍的表。 */}
      <dl className="project-start__intent">
        <div><dt>要回答的问题</dt><dd>{context.problem.statement}{context.problem.origin === "hypothesis" ? <em>（假设，尚待验证）</em> : null}</dd></div>
        <div><dt>要留下的判断</dt><dd>{context.coreClaim}</dd></div>
        {context.route ? <div><dt>选定的讲法</dt><dd>{context.route.storyline}</dd></div> : null}
      </dl>

      <ErrorNote error={error} what={outline ? "起稿" : "搭结构"} onRetry={outline ? () => buildDraft() : () => buildOutline()} />

      {busy && !outline ? (
        <p className="project-start__pending" aria-live="polite">
          正在按选定的讲法，把 {context.elements.length} 条材料排进一个结构里…通常十几秒。
        </p>
      ) : null}

      {outline ? (
        <>
          {outline.note ? <p className="project-start__note">{outline.note}</p> : null}
          <ol className="project-start__outline">
            {outline.sections.map((section, index) => (
              <li key={`${section.heading}:${index}`}>
                <strong>{section.heading}</strong>
                <p>{section.purpose}</p>
                {section.beats?.length ? <ul className="project-start__beats">{section.beats.map((beat, at) => <li key={`${beat}:${at}`}>{beat}</li>)}</ul> : null}
                {section.uses?.length ? (
                  <p className="project-start__uses">
                    用：{section.uses.map((use) => `${use.label}（${use.origin}）`).join("；")}
                  </p>
                ) : <p className="project-start__uses project-start__uses--none">这一节靠推理，不引材料</p>}
              </li>
            ))}
          </ol>
          {/*
            ⚠️ **没被安排上的材料要说出来。** 不说的话，用户以为这份结构用光了
            他攒的东西；而真实情况常常是有两条更好的没被排进去。
          */}
          {needsDraft ? (
            <p className="project-start__hint">主稿还没建；采用或起稿时会顺手建好，不用另外点一次。</p>
          ) : null}
          {outline.unused?.length ? (
            <p className="project-start__unused">
              这份结构没用上：{outline.unused.map((item) => item.label).join("、")}。
              觉得它们更重要，就重搭一个，或者自己往结构里加。
            </p>
          ) : null}
          {draftNote ? <Note title="初稿已经放进正文，等你逐处采纳">{draftNote}</Note> : null}
          {/*
            ⚠️ **不满意不该只能「再抽一次」。**
            用户通常很清楚哪儿不对（太像科普、结论下得太早、开头绕），
            让他说出来再重来一遍，比让他盲抽第二次有用得多。
          */}
          <div className="project-start__ask">
            <label htmlFor="project-start-ask">{draftNote ? "这一版哪儿不对？说一句再起一版" : "这个结构哪儿不对？说一句再重搭"}</label>
            <input
              id="project-start-ask"
              value={instruction}
              disabled={busy || drafting}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && instruction.trim()) (draftNote ? buildDraft : buildOutline)(instruction.trim()); }}
              placeholder={draftNote ? "例如：太像科普了，多讲机制少讲现象" : "例如：第三节太散，合并成一节"}
            />
          </div>
          {!context.experienceCount ? (
            <p className="project-start__gate">
              工作区里没有个人经历，所以这篇不会出现任何第一人称经历。要讲那种故事，先把它作为「个人经历」素材存进来。
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
