// 完整 Wiki 页面编译和全库体检修订都只在这里等待用户确认。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";
import { IconArrowRight, IconChevronRight, IconShieldCheck } from "./icons.jsx";

const FINDING_TYPES = {
  contradiction: { level: "高风险", label: "观点冲突", tone: "risk" },
  stale: { level: "建议修改", label: "陈旧认识", tone: "suggest" },
  source_gap: { level: "建议修改", label: "来源不足", tone: "suggest" },
  missing_page: { level: "可选优化", label: "缺少页面", tone: "optional" },
  missing_link: { level: "可选优化", label: "缺少连接", tone: "optional" },
  synthesis_gap: { level: "可选优化", label: "缺少综合", tone: "optional" },
};

const liveRepair = (item) => ["queued", "retry", "running"].includes(item.repairStatus);
const liveResearch = (item) => ["queued", "retry", "running"].includes(item.researchStatus);

function keysOf(item) {
  if (item.type === "wiki-lint") {
    return (item.findings || []).flatMap((finding, index) => finding.repairable || finding.researchable ? [`findings:${index}`] : []);
  }
  if (item.type === "research") return (item.sources || []).map((_, index) => `sources:${index}`);
  return (item.pages || []).map((_, index) => `pages:${index}`);
}

function Evidence({ quote }) {
  return quote ? <blockquote className="ing__quote">{quote}</blockquote> : null;
}

/**
 * 折叠那一行中间显示什么：**这条候选会碰到的东西的名字**。
 *
 * ⚠️ **上一版这里是一句被截断的说明**（「已阅读全文（1 段）· 基于认知神经科学与情绪
 * 构建理论，补充了创作焦虑与写作障碍的神经认知建构机制，更新了《写作障碍》、《写…」）。
 * 它有两个毛病，而且是一起犯的：
 *   1. **每行开头都一样**（「已阅读全文（N 段） · 」），真正不同的部分被挤到后面截掉；
 *   2. **它回答不了这一行要回答的问题**。你在这儿要决定的是「让不让 AI 改我的 Wiki」，
 *      而做这个决定靠的是**它要改哪几页**——那几个页面名一直就在数据里
 *      （`item.pages[].title`），却被折叠藏着，只在展开后才看得到。
 *
 * 现在中间那一列直接列页面名：`写作障碍 · 写作 · 情绪构建理论`。一行放得下，
 * 而且五行并排时你一眼就看得出哪几页被反复改（这一屏里《写作》被三份来源同时盯上）。
 *
 * 四种候选各自「碰的东西」不一样，但都是一串名字，所以合成同一个形状：
 *   编译 / 修订 → 会写入的页面；补充来源 → 找到的来源；体检 → 被诊断到的页面。
 */
function subjectsOf(item) {
  if (item.type === "research") return (item.sources || []).map((source) => ({ name: source.title, isNew: true }));
  if (item.type === "wiki-lint") {
    const seen = new Set();
    for (const finding of item.findings || []) for (const page of finding.pages || []) seen.add(page);
    return [...seen].map((name) => ({ name, isNew: false }));
  }
  return (item.pages || []).map((page) => ({ name: page.title, isNew: page.action === "create" }));
}

export function IngestReview({ onDone, focusSourceId = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [openId, setOpenId] = useState("");
  const [selected, setSelected] = useState({});
  const [success, setSuccess] = useState("");
  const focused = useRef("");

  const load = useCallback(async () => {
    try {
      const result = await api.knowledgeCandidates();
      setData(result);
      setError(null);
      setSelected((current) => {
        const next = { ...current };
        for (const item of result.candidates || []) if (!next[item.id]) next[item.id] = new Set(keysOf(item));
        return next;
      });
      return result;
    } catch (failure) {
      setError(failure);
      return null;
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!focusSourceId || focused.current === focusSourceId || !data) return;
    const item = (data.candidates || []).find((candidate) => candidate.sourceId === focusSourceId || candidate.sourceBookId === focusSourceId);
    if (!item) return;
    focused.current = focusSourceId;
    setOpenId(item.id);
    window.requestAnimationFrame(() => document.getElementById(`knowledge-candidate-${item.id}`)?.scrollIntoView({ block: "center" }));
  }, [data, focusSourceId]);

  const hasLiveRepair = (data?.candidates || []).some((item) => liveRepair(item) || liveResearch(item));
  useEffect(() => {
    if (!hasLiveRepair) return undefined;
    const timer = window.setInterval(load, 2_000);
    return () => window.clearInterval(timer);
  }, [hasLiveRepair, load]);

  const decide = useCallback(async (item, action) => {
    setBusy(item.id);
    try {
      const include = action === "accept" && ["compile", "repair", "research"].includes(item.type)
        ? [...(selected[item.id] || [])] : undefined;
      const result = await api.knowledgeCandidateDecide(item.id, action, include);
      if (action === "accept" && item.type === "research") {
        const applied = result.applied || {};
        setSuccess(`已确认 ${applied.selected || 0} 份来源：${applied.imported || 0} 份已导入 Raw，${applied.queued || 0} 节已进入 Wiki 编译队列。编译完成后仍需逐页审阅。`);
      }
      setData((current) => current && { ...current, candidates: current.candidates.filter((candidate) => candidate.id !== item.id) });
      onDone?.();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }, [onDone, selected]);

  const generateRepair = useCallback(async (item) => {
    setBusy(`repair:${item.id}`);
    try {
      const include = [...(selected[item.id] || [])].filter((key) => {
        const index = Number(key.split(":")[1]);
        return item.findings?.[index]?.repairable;
      });
      await api.knowledgeCandidateRepair(item.id, include);
      setData((current) => current && {
        ...current,
        candidates: current.candidates.map((candidate) => candidate.id === item.id
          ? { ...candidate, repairStatus: "queued", repairError: "" } : candidate),
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }, [selected]);

  const generateResearch = useCallback(async (item) => {
    setBusy(`research:${item.id}`);
    try {
      const include = [...(selected[item.id] || [])].filter((key) => {
        const index = Number(key.split(":")[1]);
        return item.findings?.[index]?.researchable;
      });
      await api.knowledgeCandidateResearch(item.id, include);
      setData((current) => current && {
        ...current,
        candidates: current.candidates.map((candidate) => candidate.id === item.id
          ? { ...candidate, researchStatus: "queued", researchError: "" } : candidate),
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }, [selected]);

  const toggle = useCallback((id, key) => {
    setSelected((current) => {
      const next = new Set(current[id] || []);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...current, [id]: next };
    });
  }, []);

  const candidates = data?.candidates || [];
  const totalFindings = useMemo(() => candidates.reduce((sum, item) => sum
    + (item.type === "wiki-lint" ? item.findings?.length || 0
      : item.type === "research" ? item.sources?.length || 0 : item.pages?.length || 0), 0), [candidates]);
  const reportsOnly = candidates.length > 0 && candidates.every((item) => item.type === "wiki-lint");
  const focusedMissing = Boolean(focusSourceId && data
    && !candidates.some((item) => item.sourceId === focusSourceId || item.sourceBookId === focusSourceId));
  if (error) return <ErrorNote error={error} what="知识候选" onRetry={load} />;
  if (!candidates.length && !focusedMissing && !success) return null;

  /**
   * 一张待写入页面。**排版顺序就是判断顺序**：这是新建还是改已有 → 改的是哪一页 →
   * 它以后会是什么 → 这次为什么改 → 凭哪句原文 → 要不要逐字对照。
   *
   * ⚠️ **不能整块包在 `<label>` 里。** 点 label 内任何东西都会切换那颗复选框，
   * 于是「展开对照完整内容」会顺手把这一页从采纳列表里取消掉——而屏幕上只是
   * 勾没了，不报错。只有标题那一行是 label，`<details>` 留在外面。
   */
  const pageLine = (item, page, index) => {
    const key = `pages:${index}`;
    const checked = selected[item.id]?.has(key) !== false;
    const inputId = `ing-page-${item.id}-${index}`;
    return (
      <div key={key} className={`ing__choice${checked ? "" : " is-off"}`}>
        <input id={inputId} type="checkbox" checked={checked} onChange={() => toggle(item.id, key)} />
        <div className="ing__choice-body">
          <label className="ing__choice-head" htmlFor={inputId}>
            <i data-action={page.action}>{page.action === "update" ? "更新页面" : "新建页面"}</i>
            <b>{page.title}</b>
            <em>{page.citations?.length || 0} 处引用 · {page.links?.length || 0} 个连接</em>
          </label>
          <p className="ing__choice-summary">{page.summary}</p>
          {page.changeSummary ? <p className="ing__why">{page.changeSummary}</p> : null}
          <Evidence quote={page.citations?.[0]?.quote} />
          <details className="ing__diff">
            <summary>对照完整内容</summary>
            {page.beforeBodyMarkdown ? <><b>修改前</b><pre>{page.beforeBodyMarkdown}</pre></> : null}
            <b>修改后</b><pre>{page.bodyMarkdown}</pre>
          </details>
        </div>
      </div>
    );
  };

  return (
    <section className="ing" aria-label="待审阅的知识候选">
      {success ? <p className="ing__notice is-success" role="status">{success}</p> : null}
      {focusedMissing ? (
        <div className="ing__missing" role="status">
          <div><b>这份来源当前没有可审阅内容</b><span>上一次候选已经失效或编译失败，请回到来源页查看错误并重新编译。</span></div>
          <a href="#/sources">返回来源</a>
        </div>
      ) : null}
      {candidates.length ? <h3 className="ing__head">
        {reportsOnly ? `${candidates.length} 份体检报告待处理` : `${candidates.length} 份知识候选待审阅`}
        <em>{reportsOnly ? `共 ${totalFindings} 项诊断；先生成修订，确认后才会改 Wiki` : `共 ${totalFindings} 项；逐页对照后决定是否写入`}</em>
      </h3> : null}

      {candidates.map((item) => {
        const expanded = openId === item.id;
        const allKeys = keysOf(item);
        const kept = selected[item.id]?.size ?? allKeys.length;
        const isLint = item.type === "wiki-lint";
        const isRepair = item.type === "repair";
        const isResearch = item.type === "research";
        const repairing = liveRepair(item) || busy === `repair:${item.id}`;
        const researching = liveResearch(item) || busy === `research:${item.id}`;
        const repairReady = item.repairStatus === "ready";
        const researchReady = item.researchStatus === "ready";
        const repairCount = isLint ? [...(selected[item.id] || [])].filter((key) => item.findings?.[Number(key.split(":")[1])]?.repairable).length : 0;
        const researchCount = isLint ? [...(selected[item.id] || [])].filter((key) => item.findings?.[Number(key.split(":")[1])]?.researchable).length : 0;
        const subjects = subjectsOf(item);
        const shown = subjects.slice(0, 4);
        const rest = subjects.length - shown.length;
        /** 展开之后才说的那句话：读了多少、这一份大意是什么。折叠时它挤掉的是页面名。 */
        const context = isLint ? "页面问题生成修订；来源问题先搜索资料，二者都要再次确认"
          : isRepair ? item.repairSummary || "根据所选体检问题生成，尚未写入 Wiki"
          : isResearch ? "AI 已读取公开网页；确认后才会导入 Raw 并开始 Wiki 编译"
          : `已阅读全文（${item.chunksRead || 1} 段） · ${item.compilationSummary || item.bookTitle}`;
        return (
          <article id={`knowledge-candidate-${item.id}`} key={item.id} className={`ing__item${expanded ? " is-open" : ""}${isLint ? " ing__item--lint" : ""}${isRepair ? " ing__item--repair" : ""}${isResearch ? " ing__item--research" : ""}`}>
            <div className="ing__row">
              <button type="button" className="ing__title" aria-expanded={expanded} onClick={() => setOpenId(expanded ? "" : item.id)}>
                {/* ⚠️ **展开才是这张卡的主路径。** 采纳按钮以前是实心黑，而标题上
                    没有任何可展开的记号——最省力的动作就成了「不看内容直接写进 Wiki」。
                    箭头把「逐页对照」摆回视线里，采纳和拒绝现在**只在展开之后存在**。 */}
                <IconChevronRight aria-hidden="true" stroke={1.8} data-open={expanded ? "" : undefined} />
                <b>{isLint ? "全库体检报告" : isRepair ? "体检修订候选" : isResearch ? "补充来源候选" : item.sourceTitle || "未命名资料"}</b>
              </button>

              {/* 中间：会碰到的东西的名字。这才是「让不让它改」的判断材料，理由见 `subjectsOf` */}
              <span className="ing__subjects">
                {shown.length ? shown.map((subject, index) => (
                  <span key={`${subject.name}-${index}`} className="ing__subject" data-new={subject.isNew ? "" : undefined}>
                    {subject.name}
                  </span>
                )) : <span className="ing__subject is-none">没有可应用的修改</span>}
                {rest > 0 ? <span className="ing__subject is-rest">+{rest}</span> : null}
              </span>

              {/**
                * ⚠️ **折叠时右端只有一句「看改动」，没有按钮。**
                * 五份候选各挂两颗描边钮就是十圈边框——那会成为这一屏最强的视觉节奏，
                * 而它们代表的是「不看内容直接写进 Wiki」。展开之后这一行会吸顶，
                * 真正的采纳/拒绝在那时才出现，就在手边。
                */}
              {expanded ? null : <span className="ing__peek" aria-hidden="true">看改动<IconArrowRight size={14} stroke={1.8} /></span>}
              {expanded ? <div className="ing__actions">
                <button type="button" disabled={!!busy || repairing || researching} onClick={() => decide(item, "reject")}>{isLint ? "暂不处理" : isRepair ? "放弃修订" : isResearch ? "不导入" : "整份拒绝"}</button>
                {isLint ? (
                  <>
                    {researchCount ? <button type="button" disabled={!!busy || repairing || researching || researchReady} onClick={() => generateResearch(item)}>
                      {researchReady ? "来源候选已生成" : researching ? "正在搜索来源…" : item.researchStatus === "failed" ? `重新搜索来源（${researchCount}）` : `同意发送页面名称并搜索（${researchCount}）`}
                    </button> : null}
                    {repairCount ? <button type="button" className="is-strong" disabled={!!busy || repairing || researching || repairReady} onClick={() => generateRepair(item)}>
                      {repairReady ? "修订候选已生成" : repairing ? "正在生成修订…" : item.repairStatus === "failed" ? `重新生成修订（${repairCount}）` : `生成页面修订（${repairCount}）`}
                    </button> : null}
                  </>
                ) : (
                  <button type="button" className="is-strong" disabled={!!busy || kept === 0} onClick={() => decide(item, "accept")}>{busy === item.id ? "处理中…" : isRepair ? `应用所选修改（${kept}）` : isResearch ? `导入所选并开始编译（${kept}）` : kept === allKeys.length ? "全部接受" : `接受所选（${kept}）`}</button>
                )}
              </div> : null}
            </div>

            {isLint && (repairing || item.repairStatus === "failed") ? (
              <p className={`ing__repair-status${item.repairStatus === "failed" ? " is-error" : ""}`} role="status">
                {item.repairStatus === "failed" ? `上次生成失败：${item.repairError || "可重新尝试"}` : "AI 正在对照现有页面和来源生成完整修订，完成后这里会出现可逐页确认的候选。"}
              </p>
            ) : null}
            {isLint && (researching || item.researchStatus === "failed") ? (
              <p className={`ing__repair-status${item.researchStatus === "failed" ? " is-error" : ""}`} role="status">
                {item.researchStatus === "failed" ? `上次搜索失败：${item.researchError || "可重新尝试"}` : "正在搜索并读取公开网页。完成后会出现来源卡片，未经确认不会导入。"}
              </p>
            ) : null}

            {expanded ? (
              <div className="ing__body">
                {/* 折叠行原来把这句话摆在中间，于是每行开头都是一样的「已阅读全文（N 段）·」，
                    真正不同的那半句反而被截掉。它属于「已经决定要看了」之后的上下文。 */}
                <p className="ing__context">{context}</p>
                {item.rejected?.length || item.unresolved?.length ? (
                  <p className="ing__gate">
                    <IconShieldCheck size={14} stroke={1.8} aria-hidden="true" />
                    <span>
                    {item.rejected?.length ? `证据校验已拦下 ${item.rejected.length} 条不可靠修改，它们不会进入正式知识。` : ""}
                    {item.rejected?.length && item.unresolved?.length ? " " : ""}
                    {item.unresolved?.length ? `另有 ${item.unresolved.length} 项建议未生成可用修订，仍保留为待处理问题。` : ""}
                    </span>
                  </p>
                ) : null}
                {(item.pages || []).map((page, index) => pageLine(item, page, index))}
                {isResearch ? (
                  <div className="ing__sources">
                    {(item.sources || []).map((source, index) => {
                      const key = `sources:${index}`;
                      const checked = selected[item.id]?.has(key) !== false;
                      return <label key={key} className={`ing__source${checked ? "" : " is-off"}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(item.id, key)} />
                        <span>
                          <span className="ing__source-head"><b>{source.title}</b><a href={source.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>查看原文</a></span>
                          <small>{[source.siteName, source.author, source.publishedAt?.slice?.(0, 10), source.words ? `${source.words.toLocaleString()} 字` : ""].filter(Boolean).join(" · ")}</small>
                          <p>{source.excerpt}</p>
                          <em>用于处理：{source.why}</em>
                        </span>
                      </label>;
                    })}
                  </div>
                ) : null}
                {isLint ? (
                  <ol className="ing__findings">
                    {(item.findings || []).map((finding, index) => {
                      const meta = FINDING_TYPES[finding.type] || { level: "建议修改", label: "知识问题", tone: "suggest" };
                      const key = `findings:${index}`;
                      const checked = selected[item.id]?.has(key) === true;
                      const content = <>
                        <div className="ing__finding-head">
                          <span className={`ing__finding-level is-${meta.tone}`}>{meta.level}</span>
                          <b>{meta.label}</b>
                          <span className="ing__finding-pages">{(finding.pages || []).join("、") || "全库"}</span>
                          {finding.researchable ? <span className="ing__finding-blocked">先查来源</span> : !finding.repairable ? <span className="ing__finding-blocked">暂不支持</span> : null}
                        </div>
                        <p>{finding.problem}</p>
                        <p className="ing__finding-suggestion"><span>建议</span>{finding.suggestion}</p>
                        {!finding.repairable ? <p className="ing__finding-reason">{finding.reason}</p> : null}
                      </>;
                      return finding.repairable || finding.researchable ? (
                        <li key={key} className={`ing__finding${checked ? "" : " is-off"}`}>
                          <label><input type="checkbox" checked={checked} onChange={() => toggle(item.id, key)} /><span>{content}</span></label>
                        </li>
                      ) : <li key={key} className="ing__finding is-blocked"><div className="ing__finding-static">{content}</div></li>;
                    })}
                  </ol>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
