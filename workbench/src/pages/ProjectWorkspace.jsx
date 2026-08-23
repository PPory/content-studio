import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { projectPhase } from "../lib/content-projects.js";
import { MarkdownEditor } from "../components/MarkdownEditor.jsx";
import { WritingAssist } from "../components/WritingAssist.jsx";
import { PublishPanel } from "../components/PublishPanel.jsx";
import { ProjectReviewStage } from "../components/ProjectReviewStage.jsx";
import { ErrorNote, Loading, StatePill } from "../components/ui.jsx";
import { ProjectRefs } from "./project/ProjectRefs.jsx";
import { ProjectSeed } from "./project/ProjectSeed.jsx";
import { prepareTypesetHandoff, typesetMarkdown } from "../lib/typeset-handoff.js";
import { setOpenTarget } from "../lib/open-target.js";
import { projectReleaseDrafts, releaseChanged, releaseForm, releasePayload } from "../lib/project-release.js";
import { IconArrowLeft, IconArrowRight, IconBrandWechat, IconCheck, IconCopy, IconLoader2, IconPlus, IconRefresh } from "../components/icons.jsx";

/**
 * ⚠️ **七段流程线整条撤了。** 它画的是 Worker 的状态机，不是你的动线：
 * 七段里有三段你根本不出现（生成中＝等 cron、待复盘＝等平台数据、已完成＝终点）。
 * 而且它会骗人——一篇 0 字的空稿子照样能走到第 4 格并显示"三段已完成"，
 * **进度条画的是流程走了多远，不是内容写了多少**，那一页上这两件事长得一模一样。
 * 这一页只需要回答一句话：**现在轮到谁、要做什么**。三档 pill + 一句原因 + 一颗按钮。
 */
const PRIMARY_ACTION = {
  策划中: { action: "start-writing", label: "建立主稿" },
  生成中: null,
  // ⚠️ 「诊断」那一档撤了：Worker 里没有任何实现。两条命令合并成了 finish-writing
  写作中: { action: "finish-writing", label: "写完了，去发布" },
  已搁置: { action: "return-writing", label: "恢复写作" },
};

function materialText(item) {
  const source = item.sourceUrl ? `\n\n来源：${item.sourceUrl}` : "";
  return `> ${item.content || item.title}${source}`;
}

function ProjectReleaseRail({ project, drafts, draft, form, dirty, busy, onChange, onSelect, onAdd, onRemove, onSave, onTypeset, onCopy, onPublished }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const used = new Set(drafts.map((item) => item.platform));
  const available = (project.releaseOptions || []).filter((item) => !used.has(item.platform));
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

      {/**
        * ⚠️ **这一栏装的是「你去平台后台时要粘贴的东西」，不是系统需要的表单。**
        * 追过下游：`摘要` 进 vault 归档的 frontmatter，其余几项**只写进 D1，没有任何
        * 地方读**（排版工具只拿 title + body）。原来界面像是在等你填，而其实是在替你
        * 记草稿——两回事，所以这行小字不能省。
        *
        * ⚠️ **撤了五个框，分两批：**「画面备注」「互动目标」（它们在任何平台后台
        * 都没有对应字段），以及**「封面图片地址」「封面上的主文案」「关键词」**——
        * 后三个追下游追到底是：`release-package.js` 存进 D1、再读出来画给你自己看，
        * **没有任何消费者**。它们让你在工作台里抄一遍你反正要在平台后台填的东西，
        * 而上面那行小字自己写着「不会自动填过去」。
        *
        * ⚠️ **撤的是界面，列留在 drafts 表上。** 删列的话，以后真接了自动发布要重新加，
        * 而库里那几行历史值也就一起没了。`releasePackage` 照旧接受这几个字段。
        */}
      <p className="release-hint">下面这些是发布时你要往平台后台填的，工作台只替你记着，不会自动填过去。</p>

      <label className="release-field">
        <span>摘要</span>
        <textarea rows="3" value={form.summary} onChange={(event) => onChange("summary", event.target.value)} placeholder="这篇内容给读者什么价值" />
      </label>

      {dirty ? <button className="btn project-publish__save" onClick={onSave} disabled={busy}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}保存当前版本</button> : null}

      {/**
        * ⚠️ **这儿不再重复「去排版」。**
        * 上一版公众号那一档在这里画的是「载入排版工具」，而顶栏那颗主操作按的是
        * **同一个 `onTypeset`**——**一个动作两颗按钮、两个名字，还都是实心黑**，
        * 而实心黑一屏只留一颗（它的意思是「点这儿」，两处就等于没说）。
        * 留顶栏那一颗：那是每个阶段主操作固定的位置。
        *
        * 复制是这一栏自己的动作（排版工具之外的平台也用得上），所以留下，但退成次级。
        */}
      <button className="btn project-publish__primary" onClick={onCopy} disabled={busy}>
        <IconCopy aria-hidden="true" />复制当前发布稿
      </button>

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
  // 挂/摘素材自己一个 busy：它和阶段推进互不相干，共用会让整条操作条一起变灰
  const [materialBusy, setMaterialBusy] = useState(false);
  /**
   * 来源正文的抓取状态：`idle | fetching | failed`，外加抓不到时那句原因。
   *
   * ⚠️ **原因只活在这一次会话里，不进库。** 它是**域名的函数**（`whyNot`，服务端），
   * 而不是某一次抓取的偶然结果——为它单开一列，是把一个能算出来的东西存成了状态。
   * 下次进来看到的是「没抓到 + 再试一次」，点一下就重新拿到准确原因。
   */
  const [srcFetch, setSrcFetch] = useState({ state: "idle", why: "" });
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

  /**
   * 挂上 / 摘掉一条素材。
   *
   * ⚠️ **和 `transition` 分开一个 busy 状态。** 共用的话，挂一条素材期间
   * 整条操作条（去排版、写完了、退回写作）会一起变灰——而那两件事互不相干。
   *
   * ⚠️ **不先保存正文**：`transition` 那条要保存是因为它会锁住正文，
   * 而挂素材不动正文一个字。顺手加一次保存等于给一个无关动作绑上一次失败可能。
   */
  async function changeMaterials(change) {
    if (materialBusy) return;
    setMaterialBusy(true); setError(null);
    try {
      const result = await api.updateProjectMaterials(projectId, change);
      acceptProject(result.project);
      onChanged?.();
    } catch (e) {
      setError(e);
    } finally {
      setMaterialBusy(false);
    }
  }

  /**
   * 把来源正文抓回来存进种子。
   *
   * ⚠️ **抓取只能在工作台侧**：`readArticle` 要 linkedom + Readability，Worker 跑不了。
   * 所以链路是「本机抓 → 存回 D1」，而不是让 Worker 去抓。
   *
   * ⚠️ **抓不到也要记 `sourceFetchedAt`。** 公众号 / 知乎 / 小红书 / 抖音 / B站
   * 都要浏览器，抓不到是常态；不记的话，每次打开这一页都会再徒劳地抓一遍。
   *
   * ⚠️ **不阻塞页面**：正文先渲染，抓到再补。这一步失败绝不能让项目页打不开。
   */
  const fetchSource = useCallback(async (seed, { force = false } = {}) => {
    const url = seed?.source?.url || "";
    if (!url || srcFetch.state === "fetching") return;
    if (!force && (seed.sourceExcerpt || seed.sourceFetchedAt)) return;
    setSrcFetch({ state: "fetching", why: "" });
    let excerpt = "";
    let why = "";
    try {
      const r = await api.readArticle(url);
      excerpt = r.article?.markdown || "";
    } catch (e) {
      why = [e.message, e.hint].filter(Boolean).join(" · ");
    }
    setSrcFetch(excerpt ? { state: "idle", why: "" } : { state: "failed", why });
    // 记账失败不能让这件事看起来失败：正文已经在屏幕上了
    await api.updateSeed(seed.id, { sourceExcerpt: excerpt, sourceFetchedAt: Math.floor(Date.now() / 1000) })
      .then(() => load())
      .catch((e) => console.warn("来源正文没存下来（这次仍然读得到）:", e.message));
  }, [srcFetch.state, load]);

  // 打开就抓一次。判据在 `fetchSource` 里，这儿只负责触发
  useEffect(() => {
    if (project?.seed) fetchSource(project.seed);
  }, [project?.seed?.id, fetchSource]);

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
  /**
   * 主操作此刻为什么点不动。空串＝能点。
   * ⚠️ **判据要和 Worker 那道闸门一致**（`draftReadyToFinish`：正文去空白后非空）。
   * 库里真出过：6 篇稿子里 3 篇正文长度是 0，其中一篇已经被推到了下一档——
   * **界面于是在要求你审阅一篇不存在的文章**。
   */
  const blockedReason = mainAction?.action === "finish-writing" && !String(form.body || "").trim()
    ? "正文还是空的，先写点东西再往发布走"
    : "";

  return (
    <div className="project-workspace">
      {/**
        * ⚠️ **这一行不再写标题。** 上一版这儿是「← 内容 / 《标题》」，而右边的
        * 简报栏里有个 `<h1>` 写同一句、正文顶上还有个可编辑的标题输入框——
        * **同一句话一屏三份，其中两份还不能改**。留下的是能改的那一份。
        * 顶栏的面包屑不可点，所以「← 内容」这条退路留着。
        */}
      <header className="project-bar">
        <div className="project-bar__left">
          <button className="project-back" onClick={() => onGo("content", "")}>
            <IconArrowLeft aria-hidden="true" />内容
          </button>
          {/* 三档：在写 / 写完了 / 发出去了。判据只写在 `content-projects.js` 的 `projectPhase` 一处 */}
          <StatePill state={projectPhase(project.stage)} />
          {project.stageReason ? <span className="project-bar__why">{project.stageReason}</span> : null}
        </div>
        <div className="project-bar__end">
          {notice ? <span className="project-notice"><IconCheck aria-hidden="true" />{notice}</span> : null}
          {saved && !dirty ? <span className="project-saved"><IconCheck aria-hidden="true" />已保存</span> : null}
          {/**
            * ⚠️ **「退回写作修改」搬到顶栏了。**
            * 它是这一页唯一的后退键，而且只在稿子锁住的那一档出现——那时候正文是只读的，
            * 没有它，发现一处错字就只剩「重新走一遍流程」这一条路。挂在右栏底部太容易漏。
            */}
          {draft && project.stage === "待发布" ? (
            <button className="btn btn-sm" onClick={() => transition("return-writing")} disabled={busy}>退回写作</button>
          ) : null}
          {draft && (draftEditable || releaseEditable) ? <button className="btn" onClick={saveDraft} disabled={busy || !dirty}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}{releaseEditable ? "保存版本" : "保存"}</button> : null}
          {project.stage === "待发布" ? (
            draft?.platform === "公众号" ? <button className="btn btn-primary" onClick={openTypeset}><IconBrandWechat aria-hidden="true" />去排版<IconArrowRight aria-hidden="true" /></button> : null
          ) : mainAction ? (
            /**
             * ⚠️ **正文为空时这颗按钮必须点不动。**
             * Worker 那侧会拒（409），这儿置灰是它的可见对应物——**光靠服务端拒绝的话，
             * 你会点下去、等一下、然后收到一句报错**，而屏幕上从头到尾没说过为什么不行。
             * `title` 里写清原因，因为一颗灰按钮自己说不了话。
             */
            <button
              className="btn btn-primary"
              onClick={() => transition(mainAction.action)}
              disabled={busy || blockedReason !== ""}
              title={blockedReason || undefined}
            >
              {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}{mainAction.label}
            </button>
          ) : null}
        </div>
      </header>
      {blockedReason ? <p className="project-bar__blocked">{blockedReason}</p> : null}

      <div className="project-workspace__grid">
        {["待复盘", "已完成"].includes(project.stage) ? (
          <ProjectReviewStage project={project} busy={busy} onSave={saveReview} />
        ) : <>
        <main className="project-draft">
          {draft ? (
            <>
              <div className="project-draft__label"><span>{draft.id === masterDraft?.id ? "主稿" : `${draft.platform} 平台版`}</span><em>{draft.id === masterDraft?.id ? draft.status : `源自主稿 · ${draft.status}`}</em></div>
              <input className="project-draft__title" value={form.title} onChange={(e) => changeForm("title", e.target.value)} aria-label={draft.id === masterDraft?.id ? "主稿标题" : `${draft.platform} 版本标题`} disabled={!draftEditable} />

              {/**
                * ⚠️ **简报贴在标题下面，不在右栏。**
                * 目标读者和核心观点是**你写的时候要瞟的东西**——你就是照着这两条写的。
                * 隔一条沟摆在右边，等于每写几句就要横跨整屏看一眼。
                * 右栏那张「简报卡」原来还有四项：stageReason（顶栏说过第三遍）、
                * 下一步（和按钮说同一件事）、主平台（写作时用不上）、「更新：刚刚」
                *（你刚打开这一页）——整卡已经撤掉。
                *
                * ⚠️ **缺的那一项要看得出是缺的**，不能一律写「—」：那样这一行看着只是留白。
                */}
              {project.brief?.audience || project.brief?.viewpoint ? (
                <dl className="project-brief-line">
                  <div><dt>写给</dt><dd data-empty={project.brief?.audience ? undefined : ""}>{project.brief?.audience || "还没定目标读者"}</dd></div>
                  <div><dt>要说</dt><dd data-empty={project.brief?.viewpoint ? undefined : ""}>{project.brief?.viewpoint || "还没定核心观点"}</dd></div>
                </dl>
              ) : null}
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
              <h2>这个项目有多篇稿件，还没有确定母版</h2>
              <p>先在右边选一篇设为母版。确认后，项目阶段和后续变体都会围绕它推进。</p>
            </div>
          ) : (
            /**
             * ⚠️ **这儿不再画第二颗「建立主稿」。**
             * 顶栏那颗（`PRIMARY_ACTION.策划中`）走的是**同一个 `start-writing`**——
             * 一个动作两颗实心黑、名字还不一样（「建立主稿」/「建立空白主稿」），
             * 看到的人第一反应是去猜它们有什么区别，而答案是没有区别。
             * 和撤掉的那颗「载入排版工具」是同一类，处理方式也一样：**留顶栏那一颗**
             *（每个阶段主操作固定的位置），这儿只说清楚该按哪儿。
             */
            <div className="project-draft__empty">
              <h2>简报已经建好，主稿还没开始</h2>
              <p>点右上角的<b>「{PRIMARY_ACTION[project.stage]?.label || "建立主稿"}」</b>开始写。建好之后这个地址会一直保留；关闭再打开，仍然回到同一篇内容。</p>
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
        ) : (
          /**
           * ⚠️ **右栏是「关于这一篇的事实」，不是第二个正文区。**
           * 上一版是三栏：左边 245px 的简报、中间正文、右边 320px 的素材——
           * 每次要读自己写的字，眼睛得先越过一整栏元信息。四张参考图在这一点上一致：
           * **中间是你动手的东西，两侧只有一侧放关于它的事实。**
           */
          <aside className="project-rail">
            {/**
              * ⚠️ **右栏只剩素材。** 原来上面还有一张「简报卡」，六项里四项是重复或零信息，
              * 剩下两项（目标读者/核心观点）已经搬到正文标题下面——你写的时候要瞟的是它们。
              */}
            {project.variants?.length && !project.masterDraft ? (
              <section className="pmat" aria-label="选择母版">
                <h2 className="section-label">这个项目有多篇稿件</h2>
                <p className="pmat__note">先选一篇设为母版，项目阶段和后续变体都会围绕它推进。</p>
                {project.variants.map((item) => (
                  <button key={item.id} type="button" className="btn btn-sm btn-block" style={{ marginTop: 6 }} onClick={() => transition("set-primary", { draftId: item.id })}>
                    {item.platform} · {item.title}
                  </button>
                ))}
              </section>
            ) : null}
            {/**
              * ⚠️ **种子块排在素材上面，因为它回答的是更前面那个问题。**
              * 素材说「凭什么信我」，种子说「我要说什么」——写不下去的时候
              * 回来读的是后者。没有种子的项目整块不画（组件里自己判）。
              */}
            <ProjectSeed
              seed={project.seed}
              fetching={srcFetch.state === "fetching"}
              failedWhy={srcFetch.state === "failed" ? srcFetch.why : ""}
              onRetry={() => fetchSource(project.seed, { force: true })}
            />
            <ProjectRefs
              materials={project.materials || []}
              canInsert={draftEditable}
              /**
               * 跳去素材页并把那条来源打开。走的是 `open-target.js` 那张一次性交接条——
               * 素材页列表加载完会取一次、用掉。**不往 hash 里塞 id**：这个项目的 hash 是
               * 两段而且状态值本身带斜杠，加一段就要重新处理分隔符规则。
               */
              onOpenSource={(inspirationId) => {
                setOpenTarget("materials", `inbox:${inspirationId}`);
                onGo("materials", "");
              }}
              /**
               * 「找相关素材」拿什么去找。**优先那句话本身**——你要找的是
               * 「支持这个判断的依据」，不是「和标题字面像的东西」。
               * 没有种子时退回核心观点，再退回标题。
               */
              query={project.seed?.take || project.brief?.viewpoint || project.title || ""}
              busy={materialBusy}
              onAttach={(id) => changeMaterials({ add: [id] })}
              onDetach={(id) => changeMaterials({ remove: [id] })}
              onInsert={(item) => setInsertRequest({ id: `material-${item.id}-${Date.now()}`, text: materialText(item), spacing: "paragraph" })}
            />
          </aside>
        )}
        </>}
      </div>
      {["待复盘", "已完成"].includes(project.stage) ? <ErrorNote error={error} what="保存复盘" /> : null}
    </div>
  );
}
