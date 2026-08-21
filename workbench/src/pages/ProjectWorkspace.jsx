import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { PROJECT_STAGES, PROJECT_STAGE_META } from "../lib/content-projects.js";
import { MarkdownEditor } from "../components/MarkdownEditor.jsx";
import { WritingAssist } from "../components/WritingAssist.jsx";
import { PublishPanel } from "../components/PublishPanel.jsx";
import { ProjectReviewStage } from "../components/ProjectReviewStage.jsx";
import { ErrorNote, Loading } from "../components/ui.jsx";
import { prepareTypesetHandoff, typesetMarkdown } from "../lib/typeset-handoff.js";
import { projectReleaseDrafts, releaseChanged, releaseForm, releasePayload } from "../lib/project-release.js";
import { IconArrowLeft, IconArrowRight, IconBrandWechat, IconCheck, IconCopy, IconLoader2, IconPhoto, IconPlus, IconRefresh, IconTag, IconTarget } from "../components/icons.jsx";

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

function ProjectReleaseRail({ project, drafts, draft, form, dirty, busy, onChange, onSelect, onAdd, onRemove, onSave, onTypeset, onCopy, onPublished }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const isWechat = draft?.platform === "公众号";
  const used = new Set(drafts.map((item) => item.platform));
  const available = (project.releaseOptions || []).filter((item) => !used.has(item.platform));
  const spec = draft?.release?.spec || {};
  return (
    <aside className="project-publish" aria-label="发布准备">
      <div className="project-publish__head">
        <span>发布版本</span>
        <b>{drafts.length} 版</b>
      </div>

      <div className="release-switcher" aria-label="选择发布版本">
        {drafts.map((item, index) => (
          <button key={item.id} type="button" data-active={item.id === draft.id || undefined} onClick={() => onSelect(item)}>
            <span>{item.platform}</span><small>{index === 0 ? "母版" : "平台版"}</small>
          </button>
        ))}
        {available.length ? <button type="button" className="release-switcher__add" onClick={() => setAdding((value) => !value)}><IconPlus aria-hidden="true" />增加平台</button> : null}
      </div>

      {adding ? (
        <div className="release-add" role="group" aria-label="新增平台版本">
          <small>从已确认母版复制一份，之后单独调整，不会改动母版。</small>
          <div>{available.map((item) => <button key={item.platform} type="button" onClick={() => { setAdding(false); onAdd(item.platform); }}>{item.platform}<span>{item.coverLabel} {item.coverRatio}</span></button>)}</div>
        </div>
      ) : null}

      <div className="release-current">
        <span>{draft.id === project.masterDraft?.id ? "已确认母版" : "由母版派生"}</span>
        <b>{draft.platform}</b>
        <small>{dirty ? "有修改待保存" : draft.release?.readiness?.complete ? "发布包已齐" : `还可补：${draft.release?.readiness?.missing?.join("、") || "无"}`}</small>
      </div>
      {draft.id !== project.masterDraft?.id ? (
        removing ? <div className="release-remove"><span>移除后，这个平台版的修改会丢失。</span><button type="button" onClick={() => { setRemoving(false); onRemove(draft.id); }}>确认移除</button><button type="button" onClick={() => setRemoving(false)}>取消</button></div>
          : <button type="button" className="release-remove__start" onClick={() => setRemoving(true)} disabled={dirty || busy} title={dirty ? "先保存或还原当前修改" : "移除未发布的平台版本"}>移除这个平台版本</button>
      ) : null}

      <label className="release-field">
        <span>摘要</span>
        <textarea rows="3" value={form.summary} onChange={(event) => onChange("summary", event.target.value)} placeholder="这篇内容给读者什么价值" />
      </label>

      <section className="release-cover">
        <div className="release-cover__head"><span><IconPhoto aria-hidden="true" />{spec.coverLabel || "封面"}</span><small>{spec.coverRatio || "按平台尺寸"}</small></div>
        <div className="release-cover__preview" data-empty={!form.coverUrl || undefined}>
          {form.coverUrl ? <img src={form.coverUrl} alt={form.coverText || "发布封面预览"} /> : <div><b>{form.coverText || "封面待补"}</b><small>{form.coverNote || "先定文案和视觉方向，图片地址可以最后补。"}</small></div>}
        </div>
        <input value={form.coverUrl} onChange={(event) => onChange("coverUrl", event.target.value)} placeholder="封面图片地址 https://…" aria-label="封面图片地址" />
        <input value={form.coverText} onChange={(event) => onChange("coverText", event.target.value)} placeholder="封面上的主文案" aria-label="封面文案" />
        <textarea rows="2" value={form.coverNote} onChange={(event) => onChange("coverNote", event.target.value)} placeholder="画面、人物、配色或构图备注" aria-label="封面视觉备注" />
      </section>

      <label className="release-field release-field--icon">
        <span><IconTag aria-hidden="true" />关键词</span>
        <input value={form.keywords} onChange={(event) => onChange("keywords", event.target.value)} placeholder="写作，复利，个人成长" />
      </label>
      <label className="release-field release-field--icon">
        <span><IconTarget aria-hidden="true" />互动目标</span>
        <textarea rows="2" value={form.interactionGoal} onChange={(event) => onChange("interactionGoal", event.target.value)} placeholder="希望读者评论、收藏或转发什么" />
      </label>

      {dirty ? <button className="btn project-publish__save" onClick={onSave} disabled={busy}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}保存当前版本</button> : null}

      {isWechat ? (
        <button className="btn btn-primary project-publish__primary" onClick={onTypeset} disabled={busy}>
          <IconBrandWechat aria-hidden="true" />载入排版工具<IconArrowRight aria-hidden="true" />
        </button>
      ) : (
        <button className="btn btn-primary project-publish__primary" onClick={onCopy} disabled={busy}>
          <IconCopy aria-hidden="true" />复制当前发布稿
        </button>
      )}

      <PublishPanel
        item={{
          key: draft.id,
          title: form.title,
          raw: {
            platform: draft.platform,
            status: draft.publicationStatus,
            publishedUrl: project.publication?.latest?.draftId === draft.id ? project.publication.latest.url : "",
            publishedAt: project.publication?.latest?.draftId === draft.id ? project.publication.latest.publishedAt : "",
          },
        }}
        doc={{ title: form.title, content: form.body }}
        buttonClassName="btn project-publish__record"
        buttonLabel="发布后记录链接"
        blocked={dirty}
        blockedTitle="先保存当前发布版本，再记录发布"
        onPublished={onPublished}
      />
      <small className="project-publish__truth">记录的是当前选中的平台版本；链接和时间齐全后，项目才会进入复盘。</small>
    </aside>
  );
}

export function ProjectWorkspace({ projectId, onGo, onChanged }) {
  const [project, setProject] = useState(null);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [form, setForm] = useState(() => releaseForm());
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const [insertRequest, setInsertRequest] = useState(null);
  const cursor = useRef(null);
  const selectedDraftRef = useRef("");

  const acceptProject = useCallback((next, preferredId = "") => {
    const drafts = projectReleaseDrafts(next);
    const selected = drafts.find((item) => item.id === (preferredId || selectedDraftRef.current)) || next?.masterDraft || drafts[0] || null;
    setProject(next);
    selectedDraftRef.current = selected?.id || "";
    setSelectedDraftId(selected?.id || "");
    setForm(releaseForm(selected || { title: next?.title || "" }));
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

  const drafts = projectReleaseDrafts(project);
  const masterDraft = project?.masterDraft;
  const draft = drafts.find((item) => item.id === selectedDraftId) || masterDraft;
  const dirty = !!draft && releaseChanged(draft, form);
  const writingEditable = project?.stage === "写作中" && draft?.id === masterDraft?.id;
  const releaseContentEditable = project?.stage === "待发布" && draft?.id !== masterDraft?.id;
  const draftEditable = writingEditable || releaseContentEditable;
  const releaseEditable = project?.stage === "待发布";

  function changeForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function saveDraft() {
    if (!draft || busy || !dirty) return true;
    setBusy(true); setError(null);
    try {
      let result;
      if (releaseEditable) {
        result = await api.saveProjectRelease(projectId, draft.id, releasePayload(form));
      } else {
        if (form.title !== (draft.title || "")) await api.updateFields("drafts", draft.id, { title: form.title.trim() || project.title });
        if (form.body !== (draft.body || "")) await api.saveContent("drafts", draft.id, form.body);
        result = await api.project(projectId);
      }
      acceptProject(result.project, draft.id);
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
    if (dirty && !(await saveDraft())) return;
    try {
      const result = prepareTypesetHandoff({
        projectId: project.id,
        draftId: draft.id,
        title: form.title,
        body: form.body,
        platform: draft.platform,
      });
      setNotice(result.mode === "resume" ? "已继续上次的排版草稿" : "已将当前主稿载入排版工具");
      onGo("typeset", "");
    } catch (e) {
      setError(Object.assign(new Error("无法准备排版草稿"), { hint: e.message }));
    }
  }

  async function copyRelease() {
    if (dirty && !(await saveDraft())) return;
    try {
      await navigator.clipboard.writeText(typesetMarkdown(form.title, form.body));
      setNotice("已复制当前发布稿");
    } catch {
      setError(new Error("复制失败，请在正文里手动复制"));
    }
  }

  async function handlePublished(result) {
    setNotice("发布已记录，项目已进入复盘");
    await load();
    onChanged?.();
  }

  async function saveReview(input) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await api.saveProjectReview(projectId, input);
      acceptProject(result.project);
      setNotice(result.feedbackCreated ? `复盘已完成，并沉淀 ${result.feedbackCreated} 条有效素材` : "复盘已完成，下一步已留存");
      onChanged?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function selectRelease(nextDraft) {
    if (!nextDraft || nextDraft.id === draft?.id) return;
    if (dirty) {
      setNotice("先保存当前版本，再切换平台");
      return;
    }
    selectedDraftRef.current = nextDraft.id;
    setSelectedDraftId(nextDraft.id);
    setForm(releaseForm(nextDraft));
    setSaved(false);
    setNotice("");
  }

  async function createVariant(platform) {
    if (busy) return;
    if (dirty && !(await saveDraft())) return;
    setBusy(true); setError(null);
    try {
      const result = await api.createProjectVariant(projectId, platform);
      acceptProject(result.project, result.variantId);
      setNotice(result.created ? `已建立 ${platform} 平台版本` : `已打开现有 ${platform} 版本`);
      onChanged?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function removeVariant(draftId) {
    if (busy || dirty) return;
    setBusy(true); setError(null);
    try {
      const result = await api.removeProjectVariant(projectId, draftId);
      acceptProject(result.project, result.project.masterDraft?.id);
      setNotice("平台版本已移除，母版没有改动");
      onChanged?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
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
          {draft && (draftEditable || releaseEditable) ? <button className="btn" onClick={saveDraft} disabled={busy || !dirty}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}{releaseEditable ? "保存版本" : "保存"}</button> : null}
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
        {["待复盘", "已完成"].includes(project.stage) ? (
          <ProjectReviewStage project={project} busy={busy} onSave={saveReview} />
        ) : <>
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
          {project.variants?.length && project.stage !== "待发布" ? (
            <div className="project-variants"><b>{project.masterDraft ? "内容变体" : "请选择母版"}</b>{project.variants.map((item) => (
              <span key={item.id}>{item.platform} · {item.title}{!project.masterDraft ? <button onClick={() => transition("set-primary", { draftId: item.id })}>设为母版</button> : null}</span>
            ))}</div>
          ) : null}
        </aside>

        <main className="project-draft">
          {draft ? (
            <>
              <div className="project-draft__label"><span>{draft.id === masterDraft?.id ? "主稿" : `${draft.platform} 平台版`}</span><em>{draft.id === masterDraft?.id ? draft.status : `源自主稿 · ${draft.status}`}</em></div>
              <input className="project-draft__title" value={form.title} onChange={(e) => changeForm("title", e.target.value)} aria-label={draft.id === masterDraft?.id ? "主稿标题" : `${draft.platform} 版本标题`} disabled={!draftEditable} />
              <MarkdownEditor
                key={`${draft.id}:${draftEditable ? "edit" : "locked"}`}
                value={form.body}
                onChange={(value) => changeForm("body", value)}
                ariaLabel={draft.id === masterDraft?.id ? "主稿正文" : `${draft.platform} 版本正文`}
                insertRequest={insertRequest}
                onInsertHandled={(id) => setInsertRequest((current) => current?.id === id ? null : current)}
                onCursorChange={(position) => { cursor.current = position; }}
                revisionScope={`pipeline:drafts:${draft.id}`}
                revisionTitle={form.title}
                revisionPlatform={draft.platform}
                readOnly={!draftEditable}
                toolbarExtra={writingEditable ? <WritingAssist title={form.title} body={form.body} platform={draft.platform} getCursor={() => cursor.current}
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
          <ProjectReleaseRail
            project={project}
            drafts={drafts}
            draft={draft}
            form={form}
            dirty={dirty}
            busy={busy}
            onChange={changeForm}
            onSelect={selectRelease}
            onAdd={createVariant}
            onRemove={removeVariant}
            onSave={saveDraft}
            onTypeset={openTypeset}
            onCopy={copyRelease}
            onPublished={handlePublished}
          />
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
        </>}
      </div>
      {["待复盘", "已完成"].includes(project.stage) ? <ErrorNote error={error} what="保存复盘" /> : null}
    </div>
  );
}
