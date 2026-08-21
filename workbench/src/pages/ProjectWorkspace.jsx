import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { PROJECT_STAGES, PROJECT_STAGE_META } from "../lib/content-projects.js";
import { MarkdownEditor } from "../components/MarkdownEditor.jsx";
import { WritingAssist } from "../components/WritingAssist.jsx";
import { PublishPanel } from "../components/PublishPanel.jsx";
import { ErrorNote, Loading } from "../components/ui.jsx";
import { prepareTypesetHandoff, typesetMarkdown } from "../lib/typeset-handoff.js";
import { IconArrowLeft, IconArrowRight, IconBrandWechat, IconCheck, IconCopy, IconLoader2, IconPlus, IconRefresh } from "../components/icons.jsx";

const FLOW = ["策划中", "生成中", "写作中", "待诊断", "待发布", "待复盘", "已完成"];

const PRIMARY_ACTION = {
  策划中: { action: "start-writing", label: "建立主稿" },
  生成中: null,
  写作中: { action: "submit-diagnosis", label: "完成写作，提交诊断" },
  待诊断: { action: "approve-diagnosis", label: "诊断通过，进入发布" },
  已搁置: { action: "return-writing", label: "恢复写作" },
};

function materialText(item) {
  const source = item.sourceUrl ? `\n\n来源：${item.sourceUrl}` : "";
  return `> ${item.content || item.title}${source}`;
}

function ProjectPublishRail({ project, draft, title, body, onTypeset, onCopy, onPublished }) {
  const isWechat = draft?.platform === "公众号";
  return (
    <aside className="project-publish" aria-label="发布准备">
      <div className="project-publish__head">
        <span>发布准备</span>
        <b>{draft?.platform || "未选平台"}</b>
      </div>
      <h2>主稿已通过诊断</h2>
      <p>从这里出发，排版、发布与链接记录都会回到同一个内容项目。</p>

      <ol className="project-publish__steps">
        <li data-done="true"><span>01</span><div><b>确认发布版</b><small>{draft?.title} · {draft?.platform}</small></div></li>
        <li><span>02</span><div><b>{isWechat ? "公众号排版" : "复制发布稿"}</b><small>{isWechat ? "已有排版草稿会继续，不被覆盖" : "复制确认后的标题与正文"}</small></div></li>
        <li><span>03</span><div><b>记录发布</b><small>链接和时间会推进项目到复盘</small></div></li>
      </ol>

      {isWechat ? (
        <button className="btn btn-primary project-publish__primary" onClick={onTypeset}>
          <IconBrandWechat aria-hidden="true" />载入排版工具<IconArrowRight aria-hidden="true" />
        </button>
      ) : (
        <button className="btn btn-primary project-publish__primary" onClick={onCopy}>
          <IconCopy aria-hidden="true" />复制当前发布稿
        </button>
      )}

      <PublishPanel
        item={{
          key: draft.id,
          title,
          raw: {
            platform: draft.platform,
            status: draft.publicationStatus,
            publishedUrl: project.publication?.latest?.draftId === draft.id ? project.publication.latest.url : "",
            publishedAt: project.publication?.latest?.draftId === draft.id ? project.publication.latest.publishedAt : "",
          },
        }}
        doc={{ title, content: body }}
        buttonClassName="btn project-publish__record"
        buttonLabel="发布后记录链接"
        onPublished={onPublished}
      />
      <small className="project-publish__truth">只有链接、时间和当前版本一起记录，项目才会进入复盘。</small>
    </aside>
  );
}

export function ProjectWorkspace({ projectId, onGo, onChanged }) {
  const [project, setProject] = useState(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const [insertRequest, setInsertRequest] = useState(null);
  const cursor = useRef(null);

  const acceptProject = useCallback((next) => {
    setProject(next);
    setTitle(next?.masterDraft?.title || next?.title || "");
    setBody(next?.masterDraft?.body || "");
    setSaved(false);
  }, []);

  const load = useCallback(async () => {
    if (!projectId) { setError(new Error("缺少内容项目 id")); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const result = await api.project(projectId);
      acceptProject(result.project);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [acceptProject, projectId]);

  useEffect(() => { load(); }, [load]);

  const draft = project?.masterDraft;
  const dirty = !!draft && (title !== (draft.title || "") || body !== (draft.body || ""));

  async function saveDraft() {
    if (!draft || busy || !dirty) return true;
    setBusy(true); setError(null);
    try {
      if (title !== (draft.title || "")) await api.updateFields("drafts", draft.id, { title: title.trim() || project.title });
      if (body !== (draft.body || "")) await api.saveContent("drafts", draft.id, body);
      const result = await api.project(projectId);
      acceptProject(result.project);
      setSaved(true);
      onChanged?.();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function transition(action, input = {}) {
    if (busy) return;
    if (dirty && !(await saveDraft())) return;
    setBusy(true); setError(null);
    try {
      const result = await api.transitionProject(projectId, action, input);
      acceptProject(result.project);
      onChanged?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function openTypeset() {
    if (!draft) return;
    try {
      const result = prepareTypesetHandoff({
        projectId: project.id,
        draftId: draft.id,
        title,
        body,
        platform: draft.platform,
      });
      setNotice(result.mode === "resume" ? "已继续上次的排版草稿" : "已将当前主稿载入排版工具");
      onGo("typeset", "");
    } catch (e) {
      setError(Object.assign(new Error("无法准备排版草稿"), { hint: e.message }));
    }
  }

  async function copyRelease() {
    try {
      await navigator.clipboard.writeText(typesetMarkdown(title, body));
      setNotice("已复制当前发布稿");
    } catch {
      setError(new Error("复制失败，请在正文里手动复制"));
    }
  }

  async function handlePublished(result) {
    setNotice(result.feedbackCreated ? `发布已记录，并沉淀 ${result.feedbackCreated} 条有效素材` : "发布已记录，项目已进入复盘");
    await load();
    onChanged?.();
  }

  if (loading && !project) return <div className="project-workspace-load"><Loading rows={5} /></div>;
  if (!project) {
    return (
      <div className="project-workspace-load">
        <button className="btn btn-sm" onClick={() => onGo("content", "")}><IconArrowLeft aria-hidden="true" />返回内容</button>
        <ErrorNote error={error} what="读取内容项目" onRetry={load} />
      </div>
    );
  }

  const mainAction = PRIMARY_ACTION[project.stage];
  const phaseIndex = FLOW.indexOf(project.stage);
  const draftEditable = project.stage === "写作中";

  return (
    <div className="project-workspace">
      <header className="project-workspace__head">
        <div className="project-workspace__crumb">
          <button onClick={() => onGo("content", "")}><IconArrowLeft aria-hidden="true" />内容</button>
          <span>/</span><span>{project.title}</span>
        </div>
        <div className="project-workspace__actions">
          {notice ? <span className="project-notice"><IconCheck aria-hidden="true" />{notice}</span> : null}
          {saved && !dirty ? <span className="project-saved"><IconCheck aria-hidden="true" />已保存</span> : null}
          {draft && draftEditable ? <button className="btn" onClick={saveDraft} disabled={busy || !dirty}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}保存</button> : null}
          {project.stage === "待发布" ? (
            draft?.platform === "公众号" ? <button className="btn btn-primary" onClick={openTypeset}><IconBrandWechat aria-hidden="true" />去排版<IconArrowRight aria-hidden="true" /></button> : null
          ) : mainAction ? (
            <button className="btn btn-primary" onClick={() => transition(mainAction.action)} disabled={busy}>
              {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}{mainAction.label}
            </button>
          ) : null}
        </div>
      </header>

      <ol className="project-flow" aria-label="内容项目进度">
        {FLOW.map((stage, index) => {
          const meta = PROJECT_STAGE_META[stage];
          const state = index < phaseIndex ? "done" : index === phaseIndex ? "current" : "later";
          return <li key={stage} data-state={state}><span>{index < phaseIndex ? "✓" : meta.index}</span><b>{meta.label}</b></li>;
        })}
      </ol>

      <div className="project-workspace__grid">
        <aside className="project-brief">
          <span className="eyebrow">PROJECT BRIEF</span>
          <h1>{project.title}</h1>
          <div className="project-stage-note"><b>{project.stage}</b><p>{project.stageReason}</p></div>
          <dl>
            <div><dt>目标读者</dt><dd>{project.brief?.audience || "尚未填写"}</dd></div>
            <div><dt>核心观点</dt><dd>{project.brief?.viewpoint || "尚未填写"}</dd></div>
            <div><dt>主平台</dt><dd>{project.brief?.platform || "尚未选择"}</dd></div>
          </dl>
          {project.blockers?.length ? (
            <div className="project-blockers"><b>需要处理</b>{project.blockers.map((item) => <p key={item}>{item}</p>)}</div>
          ) : null}
          {draft && ["待诊断", "待发布"].includes(project.stage) ? (
            <button className="project-return" onClick={() => transition("return-writing")} disabled={busy}>退回写作修改</button>
          ) : null}
          {project.variants?.length ? (
            <div className="project-variants"><b>{project.masterDraft ? "内容变体" : "请选择母版"}</b>{project.variants.map((item) => (
              <span key={item.id}>{item.platform} · {item.title}{!project.masterDraft ? <button onClick={() => transition("set-primary", { draftId: item.id })}>设为母版</button> : null}</span>
            ))}</div>
          ) : null}
        </aside>

        <main className="project-draft">
          {draft ? (
            <>
              <div className="project-draft__label"><span>主稿</span><em>{draft.status}</em></div>
              <input className="project-draft__title" value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} aria-label="主稿标题" disabled={!draftEditable} />
              <MarkdownEditor
                key={`${draft.id}:${draftEditable ? "edit" : "locked"}`}
                value={body}
                onChange={(value) => { setBody(value); setSaved(false); }}
                ariaLabel="主稿正文"
                insertRequest={insertRequest}
                onInsertHandled={(id) => setInsertRequest((current) => current?.id === id ? null : current)}
                onCursorChange={(position) => { cursor.current = position; }}
                revisionScope={`pipeline:drafts:${draft.id}`}
                revisionTitle={title}
                revisionPlatform={draft.platform}
                readOnly={!draftEditable}
                toolbarExtra={draftEditable ? <WritingAssist title={title} body={body} platform={draft.platform} getCursor={() => cursor.current}
                  onInsert={(text, meta) => setInsertRequest({ id: `writing-${Date.now()}`, text, spacing: "exact", ai: meta?.ai, kind: meta?.kind })} /> : null}
              />
            </>
          ) : project.variants?.length ? (
            <div className="project-draft__empty">
              <span>01</span><h2>这个项目有多篇稿件，还没有确定母版</h2>
              <p>请先在左侧选择一篇设为母版。确认后，项目阶段和后续变体都会围绕它推进。</p>
            </div>
          ) : (
            <div className="project-draft__empty">
              <span>01</span><h2>简报已经建好，主稿还没开始</h2>
              <p>建立主稿后，这个地址会一直保留；关闭再打开，仍然回到同一篇内容。</p>
              <button className="btn btn-primary" onClick={() => transition("start-writing")} disabled={busy}><IconPlus aria-hidden="true" />建立空白主稿</button>
            </div>
          )}
          <ErrorNote error={error} what="更新内容项目" />
        </main>

        {project.stage === "待发布" && draft ? (
          <ProjectPublishRail project={project} draft={draft} title={title} body={body} onTypeset={openTypeset} onCopy={copyRelease} onPublished={handlePublished} />
        ) : <aside className="project-materials">
          <div className="project-materials__head"><div><span className="eyebrow">REFERENCES</span><h2>项目素材</h2></div><b>{project.materials?.length || 0}</b></div>
          <p>素材不会自动改写正文。需要哪条，插入到当前光标处。</p>
          {project.materials?.length ? project.materials.map((item, index) => (
            <article key={item.id}>
              <small>{String(index + 1).padStart(2, "0")} · {item.type}</small>
              <h3>{item.title}</h3>
              <p>{item.content || "这条素材没有正文。"}</p>
              <button className="btn btn-sm" onClick={() => setInsertRequest({ id: `material-${item.id}-${Date.now()}`, text: materialText(item), spacing: "paragraph" })} disabled={!draftEditable || !item.content}>
                <IconPlus aria-hidden="true" />插到光标处
              </button>
            </article>
          )) : <div className="project-materials__empty">这个项目还没有关联素材。</div>}
          <button className="project-refresh" onClick={load} disabled={loading}><IconRefresh aria-hidden="true" />重新读取项目</button>
        </aside>}
      </div>
    </div>
  );
}
