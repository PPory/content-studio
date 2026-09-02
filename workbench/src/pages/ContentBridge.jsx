import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, Note, SearchBox } from "../components/ui.jsx";
import "./content-bridge.css";

const WIKI_FILTERS = [
  { key: "recent", label: "最近更新" },
  { key: "stance", label: "我的理解" },
  { key: "concept", label: "概念" },
  { key: "method", label: "方法" },
  { key: "topic", label: "主题" },
  { key: "synthesis", label: "综合" },
];

const ACTIONS = [
  { key: "knowledge", label: "知识型" },
  { key: "judgment", label: "判断型" },
  { key: "experience", label: "经历型" },
  { key: "demonstration", label: "展示型" },
];

const PATTERN_LABELS = {
  trend: "趋势",
  frequency: "高频",
  knowledge_gap: "知识缺口",
  feedback: "反馈",
};

const RELATION_LABELS = {
  causal: "形成因果",
  analogy: "形成类比",
  contrast: "形成对比",
  conflict: "形成张力",
  support: "支撑",
  challenge: "挑战",
  concept_to_case: "从概念落到案例",
  case_to_abstraction: "从案例提炼判断",
  problem_to_mechanism: "从问题找到机制",
  mechanism_to_method: "从机制走向方法",
};

const FIT_LABELS = { strong: "连接自然", medium: "可以发展", weak: "连接较弱" };

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function initialIds(value) {
  const text = String(value || "");
  if (text.startsWith("wiki:")) return { wikiId: text.slice(5), problemId: "", opportunityId: "" };
  if (text.startsWith("problem:")) return { wikiId: "", problemId: text.slice(8), opportunityId: "" };
  if (text.startsWith("opportunity:")) return { wikiId: "", problemId: "", opportunityId: text.slice(12) };
  return { wikiId: "", problemId: "", opportunityId: "" };
}

function SourceCount({ count }) {
  return <span>{count || 0} 个来源</span>;
}

function SelectionRow({ selected, onClick, children, ariaLabel }) {
  return (
    <button
      type="button"
      className="bridge-select-row"
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EmptySide({ children, action }) {
  return (
    <div className="bridge-side-empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

function ResultSection({ index, title, children, id }) {
  return (
    <section className="bridge-result-section" id={id} tabIndex={id ? -1 : undefined}>
      <span className="bridge-result-index">{String(index).padStart(2, "0")}</span>
      <div><h3>{title}</h3>{children}</div>
    </section>
  );
}

export function ContentBridge({ state = "", onGo }) {
  const initial = useMemo(() => initialIds(state), [state]);
  const [wikiData, setWikiData] = useState(null);
  const [problems, setProblems] = useState([]);
  const [agendas, setAgendas] = useState([]);
  const [insights, setInsights] = useState([]);
  const [recentOpportunities, setRecentOpportunities] = useState([]);
  const [agendaError, setAgendaError] = useState(null);
  const [insightsError, setInsightsError] = useState(null);
  const [recentError, setRecentError] = useState(null);
  const [agendaFitBusy, setAgendaFitBusy] = useState(false);
  const [wikiId, setWikiId] = useState(initial.wikiId);
  const [problemId, setProblemId] = useState(initial.problemId);
  const [agendaId, setAgendaId] = useState("");
  const [wikiQuery, setWikiQuery] = useState("");
  const [wikiFilter, setWikiFilter] = useState("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [entryIndex, setEntryIndex] = useState(0);
  const [extractBusy, setExtractBusy] = useState(false);
  const [extraction, setExtraction] = useState([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualStatement, setManualStatement] = useState("");
  const [manualSummary, setManualSummary] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [savedOpportunity, setSavedOpportunity] = useState(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [agendaFormOpen, setAgendaFormOpen] = useState(false);
  const [agendaTitle, setAgendaTitle] = useState("");
  const [agendaJudgment, setAgendaJudgment] = useState("");
  const [agendaCreateBusy, setAgendaCreateBusy] = useState(false);

  const evidenceRef = useRef(null);
  const counterRef = useRef(null);

  const load = async (requested = initial) => {
    setLoading(true);
    setError(null);
    setAgendaError(null);
    setInsightsError(null);
    setRecentError(null);
    const [wikiResult, problemResult, agendaResult, insightResult, recentResult, opportunityResult] = await Promise.allSettled([
      api.wiki(),
      api.audienceProblems(),
      api.agendas(),
      api.workspaceInsights(),
      api.contentOpportunities(),
      requested.opportunityId ? api.contentOpportunity(requested.opportunityId) : Promise.resolve(null),
    ]);
    try {
      if (wikiResult.status === "rejected") throw wikiResult.reason;
      if (problemResult.status === "rejected") throw problemResult.reason;
      if (opportunityResult.status === "rejected") throw opportunityResult.reason;
      const wiki = wikiResult.value;
      const problemData = problemResult.value;
      const agendaData = agendaResult.status === "fulfilled" ? agendaResult.value : { agendas: [] };
      const insightData = insightResult.status === "fulfilled" ? insightResult.value : { reports: [] };
      const opportunityData = opportunityResult.value;
      setWikiData(wiki);
      setProblems(problemData.problems || []);
      setAgendas(agendaData.agendas || []);
      setInsights(insightData.reports || []);
      setRecentOpportunities(recentResult.status === "fulfilled" ? (recentResult.value.opportunities || []).slice(0, 5) : []);
      if (agendaResult.status === "rejected") setAgendaError(agendaResult.reason);
      if (insightResult.status === "rejected") setInsightsError(insightResult.reason);
      if (recentResult.status === "rejected") setRecentError(recentResult.reason);
      const stored = opportunityData?.opportunity;
      if (stored) {
        const storedProblem = (problemData.problems || []).find((item) => item.id === stored.audienceProblemId);
        const storedAgenda = (agendaData.agendas || []).find((item) => item.id === stored.agendaId);
        setWikiId(stored.wikiPageId);
        setProblemId(stored.audienceProblemId);
        setAgendaId(stored.agendaId || "");
        setPreview({
          fit: stored.fit,
          fitReason: stored.fitReason,
          audienceProblem: { surface: storedProblem?.statement || "已保存的用户问题", underlying: storedProblem?.statement || "已保存的用户问题" },
          knowledgeExplanation: stored.knowledgeExplanation,
          coreClaim: stored.coreClaim,
          cognitiveGap: stored.cognitiveGap,
          dominantAction: stored.dominantAction,
          construction: stored.construction,
          agendaFit: {
            status: stored.agendaId ? "strong" : "none",
            reason: storedAgenda?.desiredJudgment || "这条机会暂未关联长期议程。",
          },
          freshness: stored.previewFreshness,
        });
        setSavedOpportunity(stored);
      } else {
        setWikiId(requested.wikiId);
        setProblemId(requested.problemId);
        setAgendaId("");
        setPreview(null);
        setSavedOpportunity(null);
      }
      if (requested.wikiId && !(wiki.pages || []).some((item) => item.id === requested.wikiId)) setWikiId("");
      if (requested.problemId && !(problemData.problems || []).some((item) => item.id === requested.problemId)) setProblemId("");
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(initial); }, [state]);

  const wikiPages = useMemo(() => {
    const term = wikiQuery.trim().toLowerCase();
    return (wikiData?.pages || [])
      .filter((page) => wikiFilter === "recent" || page.pageType === wikiFilter)
      .filter((page) => !term || `${page.title} ${page.summary}`.toLowerCase().includes(term));
  }, [wikiData, wikiFilter, wikiQuery]);

  const selectedWiki = (wikiData?.pages || []).find((item) => item.id === wikiId) || null;
  const selectedProblem = problems.find((item) => item.id === problemId) || null;
  const selectedAgenda = agendas.find((item) => item.id === agendaId) || null;

  const resetPreview = () => {
    setPreview(null);
    setPreviewError(null);
    setEntryIndex(0);
    setSavedOpportunity(null);
  };

  const selectWiki = (id) => {
    setWikiId(id);
    resetPreview();
  };

  const selectProblem = (id) => {
    setProblemId(id);
    resetPreview();
  };

  const runPreview = async ({ dominantAction = "", agendaOverride } = {}) => {
    if (!wikiId || !problemId) return;
    setPreviewBusy(true);
    setPreviewError(null);
    setSavedOpportunity(null);
    const effectiveAgendaId = agendaOverride === undefined ? agendaId : agendaOverride;
    try {
      const result = await api.previewContentOpportunity({
        wikiPageId: wikiId,
        audienceProblemId: problemId,
        agendaId: effectiveAgendaId || undefined,
        dominantAction: dominantAction || undefined,
      });
      setPreview(result.candidate);
      setEntryIndex(0);
    } catch (failure) {
      setPreviewError(failure);
    } finally {
      setPreviewBusy(false);
    }
  };
  const selectAgenda = async (nextAgendaId) => {
    setAgendaId(nextAgendaId);
    setSavedOpportunity(null);
    setPreviewError(null);
    if (!preview) return;
    if (!nextAgendaId) {
      setPreview((current) => ({
        ...current,
        agendaFit: { status: "none", reason: "这条机会暂不关联长期议程。" },
        freshness: { ...current.freshness, agendaId: null, agendaUpdatedAt: null },
      }));
      return;
    }
    setAgendaFitBusy(true);
    try {
      const result = await api.previewContentOpportunityAgendaFit({
        wikiPageId: wikiId,
        audienceProblemId: problemId,
        agendaId: nextAgendaId,
        candidate: {
          coreClaim: preview.coreClaim,
          cognitiveGap: preview.cognitiveGap,
          knowledgeExplanation: preview.knowledgeExplanation,
        },
      });
      setPreview((current) => ({
        ...current,
        agendaFit: result.agendaFit,
        freshness: { ...current.freshness, ...result.agendaFreshness },
      }));
    } catch (failure) {
      setPreviewError(failure);
    } finally {
      setAgendaFitBusy(false);
    }
  };

  const createAgenda = async () => {
    if (!agendaTitle.trim() || !agendaJudgment.trim()) return;
    setAgendaCreateBusy(true);
    setPreviewError(null);
    try {
      const result = await api.createAgenda({
        title: agendaTitle.trim(),
        desiredJudgment: agendaJudgment.trim(),
        confirmed: true,
      });
      setAgendas((items) => [result.agenda, ...items]);
      setAgendaError(null);
      setAgendaFormOpen(false);
      setAgendaTitle("");
      setAgendaJudgment("");
      await selectAgenda(result.agenda.id);
    } catch (failure) {
      setPreviewError(failure);
    } finally {
      setAgendaCreateBusy(false);
    }
  };


  const saveOpportunity = async () => {
    if (!preview || !wikiId || !problemId) return;
    setSaveBusy(true);
    setPreviewError(null);
    try {
      const result = await api.saveContentOpportunity({
        wikiPageId: wikiId,
        audienceProblemId: problemId,
        agendaId: agendaId || undefined,
        coreClaim: preview.coreClaim,
        knowledgeExplanation: preview.knowledgeExplanation,
        cognitiveGap: preview.cognitiveGap,
        dominantAction: preview.dominantAction,
        freshness: preview.freshness,
        fit: preview.fit,
        fitReason: preview.fitReason,
        construction: preview.construction,
        confirmed: true,
      });
      setSavedOpportunity(result.opportunity);
      setRecentOpportunities((items) => [result.opportunity, ...items.filter((item) => item.id !== result.opportunity.id)].slice(0, 5));
    } catch (failure) {
      setPreviewError(failure);
    } finally {
      setSaveBusy(false);
    }
  };

  const createProject = async () => {
    if (!savedOpportunity) return;
    setProjectBusy(true);
    setPreviewError(null);
    try {
      const result = await api.createProjectFromOpportunity(savedOpportunity.id, {
        title: savedOpportunity.coreClaim,
        confirmed: true,
      });
      onGo?.("project", result.projectId);
    } catch (failure) {
      setPreviewError(failure);
    } finally {
      setProjectBusy(false);
    }
  };

  const extractProblems = async () => {
    const insight = insights[0];
    if (!insight) {
      setPreviewError(Object.assign(new Error("目前还没有可提取的洞察报告"), { hint: "先去洞察页生成一份报告，或自己记一个问题。" }));
      return;
    }
    setExtractBusy(true);
    setPreviewError(null);
    try {
      const result = await api.extractAudienceProblems(insight.id);
      setExtraction(result.problems || []);
    } catch (failure) {
      setPreviewError(failure);
    } finally {
      setExtractBusy(false);
    }
  };

  const confirmCandidate = async (candidate) => {
    setSaveBusy(true);
    setPreviewError(null);
    try {
      const result = await api.createAudienceProblem({ ...candidate, confirmed: true });
      setProblems((items) => [result.problem, ...items]);
      setProblemId(result.problem.id);
      setExtraction((items) => items.filter((item) => item !== candidate));
      setManualOpen(false);
    } catch (failure) {
      setPreviewError(failure);
    } finally {
      setSaveBusy(false);
    }
  };

  const saveManual = async () => {
    const statement = manualStatement.trim();
    if (!statement) return;
    setSaveBusy(true);
    setPreviewError(null);
    try {
      const result = await api.createAudienceProblem({
        statement,
        summary: manualSummary.trim(),
        sourceKind: "manual",
        pattern: "feedback",
        sources: [{ sourceKind: "manual", sourceId: `manual:${Date.now()}`, evidenceText: statement, observedAt: new Date().toISOString() }],
        confirmed: true,
      });
      setProblems((items) => [result.problem, ...items]);
      setProblemId(result.problem.id);
      setManualStatement("");
      setManualSummary("");
      setManualOpen(false);
    } catch (failure) {
      setPreviewError(failure);
    } finally {
      setSaveBusy(false);
    }
  };

  const focusSection = (ref) => {
    ref.current?.scrollIntoView({ block: "center" });
    ref.current?.focus({ preventScroll: true });
  };

  if (loading) return <Loading rows={10} />;
  if (error) return <ErrorNote error={error} what="内容桥接" onRetry={load} />;

  const construction = preview?.construction || {};
  const entryOptions = construction.entry_options || [];
  const activeEntry = entryOptions[entryIndex] || null;
  const evidenceGaps = construction.evidence_gaps || [];
  const counterarguments = construction.counterarguments || [];
  const latestInsight = insights[0] || null;

  return (
    <div className="view-body content-bridge">
      <header className="bridge-head">
        <div>
          <p className="bridge-kicker">内容机会</p>
          <h2>把你搞懂的，连接到用户正在困惑的。</h2>
          <p>不从找标题开始。先看看你的知识能不能真正解决一个用户问题。</p>
        </div>
      </header>

      <section className="bridge-recent" aria-labelledby="bridge-recent-title">
        <div className="bridge-recent-head">
          <h3 id="bridge-recent-title">最近保存的内容机会</h3>
          <span>继续已有工作</span>
        </div>
        {recentError ? <p className="bridge-local-error">最近内容机会暂时无法读取，不影响新建连接。</p> : null}
        {!recentError && !recentOpportunities.length ? <p className="bridge-recent-empty">保存第一条内容机会后，可以从这里继续。</p> : null}
        {recentOpportunities.length ? (
          <div className="bridge-recent-list">
            {recentOpportunities.map((item) => (
              <button key={item.id} type="button" onClick={() => onGo?.("bridge", `opportunity:${item.id}`)}>
                <span><strong>{item.coreClaim}</strong><small>{item.audienceProblemStatement || "关联用户问题"}</small></span>
                <span className="bridge-recent-meta"><small>{dateLabel(item.updatedAt)}更新</small><em>{item.hasProject ? "已建立项目" : "待建立项目"}</em></span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <div className="bridge-picker" aria-label="选择知识和用户问题">
        <section className="bridge-side" aria-labelledby="bridge-wiki-title">
          <div className="bridge-side-head">
            <div><span>01</span><h3 id="bridge-wiki-title">我搞懂了什么</h3></div>
            <small>长期知识</small>
          </div>
          <SearchBox value={wikiQuery} onChange={setWikiQuery} placeholder="搜索我的知识" ariaLabel="搜索长期知识" />
          <div className="bridge-filter" role="tablist" aria-label="筛选知识类型">
            {WIKI_FILTERS.map((item) => (
              <button key={item.key} type="button" role="tab" aria-selected={wikiFilter === item.key} onClick={() => setWikiFilter(item.key)}>{item.label}</button>
            ))}
          </div>
          <div className="bridge-side-list">
            {!wikiData?.pages?.length ? (
              <EmptySide action={<button type="button" className="btn" onClick={() => onGo?.("entries")}>去知识库</button>}>
                先把真正值得长期保留的知识整理进知识库。
              </EmptySide>
            ) : !wikiPages.length ? (
              <EmptySide>当前筛选下没有匹配的知识页面。</EmptySide>
            ) : wikiPages.map((page) => (
              <SelectionRow key={page.id} selected={wikiId === page.id} onClick={() => selectWiki(page.id)} ariaLabel={`选择知识：${page.title}`}>
                <strong>{page.title}</strong>
                <p>{page.summary || "这页还没有一句摘要。"}</p>
                <small><SourceCount count={page.sourceCount} /> · {dateLabel(page.updatedAt)}更新</small>
              </SelectionRow>
            ))}
          </div>
        </section>

        <div className="bridge-multiply" aria-hidden="true">×</div>

        <section className="bridge-side" aria-labelledby="bridge-problem-title">
          <div className="bridge-side-head">
            <div><span>02</span><h3 id="bridge-problem-title">用户在困惑什么</h3></div>
            <small>洞察 / 反馈</small>
          </div>
          <div className="bridge-side-actions">
            <button type="button" className="btn btn-sm" disabled={extractBusy || !insights.length} onClick={extractProblems}>
              {extractBusy ? "正在提取…" : latestInsight ? `从《${latestInsight.title || latestInsight.week || "最近洞察"}》提取用户问题` : "暂无洞察可提取"}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setManualOpen((value) => !value)}>自己记一个问题</button>
          </div>
          {latestInsight ? <p className="bridge-insight-source">读取报告：{latestInsight.title || latestInsight.week || "最近洞察"}{latestInsight.generatedAt ? ` · ${dateLabel(latestInsight.generatedAt)}` : ""}</p> : null}
          {insightsError ? <p className="bridge-local-error">洞察报告暂时无法读取。你仍可选择已有问题或自己记录。</p> : null}
          {manualOpen ? (
            <div className="bridge-manual-form">
              <label>用户正在困惑什么<textarea value={manualStatement} onChange={(event) => setManualStatement(event.target.value)} rows={3} placeholder="写成一个真实问题，而不是热点标题" /></label>
              <label>为什么值得关注<textarea value={manualSummary} onChange={(event) => setManualSummary(event.target.value)} rows={2} placeholder="可选" /></label>
              <button type="button" className="btn btn-primary" disabled={!manualStatement.trim() || saveBusy} onClick={saveManual}>{saveBusy ? "正在保存…" : "确认保存"}</button>
            </div>
          ) : null}
          {extraction.length ? (
            <div className="bridge-candidates" aria-label="待确认的用户问题候选">
              <p>一个可能的用户问题</p>
              {extraction.map((candidate) => (
                <article key={`${candidate.statement}:${candidate.sources?.[0]?.sourceId}`}>
                  <strong>{candidate.statement}</strong>
                  <span>{candidate.whyItMatters}</span>
                  <small>来自最近洞察 · {PATTERN_LABELS[candidate.pattern] || candidate.pattern}</small>
                  <button type="button" className="btn btn-sm" disabled={saveBusy} onClick={() => confirmCandidate(candidate)}>确认保存</button>
                </article>
              ))}
            </div>
          ) : null}
          <div className="bridge-side-list bridge-side-list--problems">
            {!problems.length ? (
              <EmptySide>
                目前还没有整理出的用户问题。可以从最近洞察提取，或自己记一个问题。
              </EmptySide>
            ) : problems.map((problem) => (
              <SelectionRow key={problem.id} selected={problemId === problem.id} onClick={() => selectProblem(problem.id)} ariaLabel={`选择用户问题：${problem.statement}`}>
                <strong>{problem.statement}</strong>
                <p>{problem.summary || "这条问题还没有补充说明。"}</p>
                <small><SourceCount count={problem.sources?.length} /> · {PATTERN_LABELS[problem.pattern] || "反馈"}</small>
              </SelectionRow>
            ))}
          </div>
        </section>
      </div>

      <section className="bridge-connection" aria-live="polite">
        {selectedWiki && selectedProblem ? (
          <>
            <div className="bridge-equation">
              <strong>{selectedWiki.title}</strong><span>×</span><strong>{selectedProblem.statement}</strong>
            </div>
            <button type="button" className="btn btn-primary bridge-primary-action" disabled={previewBusy} onClick={() => runPreview()}>
              {previewBusy ? "正在判断连接…" : "看看怎么连接"}
            </button>
          </>
        ) : (
          <p>从两边各选一个对象，系统才会判断它们是否真的能连接。</p>
        )}
      </section>

      {previewError ? <ErrorNote error={previewError} what="内容连接" onRetry={wikiId && problemId ? () => runPreview() : undefined} /> : null}

      {preview ? (
        <div className="bridge-result" data-fit={preview.fit}>
          <div className="bridge-result-head">
            <div><span className="bridge-fit">{FIT_LABELS[preview.fit] || preview.fit}</span><p>{preview.fitReason}</p></div>
            {preview.fit === "weak" ? <strong>不建议硬做内容</strong> : null}
          </div>

          <ResultSection index={1} title="用户真正的问题"><p>{preview.audienceProblem.underlying}</p><small>表层表现：{preview.audienceProblem.surface}</small></ResultSection>
          <ResultSection index={2} title="我的知识能提供什么解释"><p>{preview.knowledgeExplanation}</p></ResultSection>
          <ResultSection index={3} title="最大的认知差"><p>{preview.cognitiveGap}</p></ResultSection>
          <ResultSection index={4} title="核心判断"><blockquote>{preview.coreClaim}</blockquote></ResultSection>
          <ResultSection index={5} title="长期议程">
            <label className="bridge-agenda-field">
              <span>这条内容会继续强化什么长期判断</span>
              <select value={agendaId} disabled={previewBusy || agendaFitBusy} onChange={(event) => selectAgenda(event.target.value)}>
                <option value="">暂不关联议程</option>
                {agendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.title}</option>)}
              </select>
            </label>
            {agendaError ? <p className="bridge-local-error">长期议程暂时无法读取，不影响继续构造和保存不关联议程的机会。</p> : null}
            <p>{agendaFitBusy ? "正在判断与议程的关系…" : selectedAgenda?.desiredJudgment || preview.agendaFit.reason}</p>
            <div className="bridge-agenda-actions">
              <button type="button" className="btn btn-sm" onClick={() => setAgendaFormOpen((value) => !value)}>＋ 新建议程</button>
              {agendaId ? <button type="button" className="btn btn-sm" disabled={previewBusy} onClick={() => runPreview({ agendaOverride: agendaId, dominantAction: preview.dominantAction })}>按这个议程重新构造</button> : null}
            </div>
            {agendaFormOpen ? (
              <div className="bridge-agenda-create">
                <label>名称<input value={agendaTitle} onChange={(event) => setAgendaTitle(event.target.value)} placeholder="例如：保留人的判断权" /></label>
                <label>希望用户最终形成什么判断<textarea rows={2} value={agendaJudgment} onChange={(event) => setAgendaJudgment(event.target.value)} placeholder="写出长期希望受众形成的稳定判断" /></label>
                <button type="button" className="btn btn-primary btn-sm" disabled={!agendaTitle.trim() || !agendaJudgment.trim() || agendaCreateBusy} onClick={createAgenda}>{agendaCreateBusy ? "正在创建…" : "确认创建"}</button>
              </div>
            ) : null}
          </ResultSection>
          <ResultSection index={6} title="怎么讲">
            <ol className="bridge-storyline">
              <li><span>①</span><div><b>从什么现实问题进入</b><p>{activeEntry?.text || preview.audienceProblem.surface}</p>{activeEntry?.scope_check?.status === "too_broad" ? <em>范围过大：{activeEntry.scope_check.reason}</em> : null}</div></li>
              <li><span>②</span><div><b>用什么知识解释</b><p>{preview.knowledgeExplanation}</p></div></li>
              <li><span>③</span><div><b>哪些东西形成关系</b><p>{(construction.relations || []).map((item) => `${RELATION_LABELS[item.type] || item.type}：${item.explanation}`).filter(Boolean).join("；") || "当前还没有足够自然的关系。"}</p></div></li>
              <li><span>④</span><div><b>最终留下什么判断</b><p>{preview.coreClaim}</p></div></li>
            </ol>
          </ResultSection>

          <div className="bridge-action-bar" aria-label="调整内容连接">
            <button type="button" disabled={entryOptions.length < 2} onClick={() => setEntryIndex((value) => (value + 1) % entryOptions.length)}>换一个大众入口</button>
            <div className="bridge-action-menu">
              <span>换一种表达方式</span>
              {ACTIONS.map((action) => <button key={action.key} type="button" aria-pressed={preview.dominantAction === action.key} disabled={previewBusy} onClick={() => runPreview({ dominantAction: action.key })}>{action.label}</button>)}
            </div>
            <button type="button" onClick={() => focusSection(evidenceRef)}>查看证据缺口</button>
            <button type="button" onClick={() => focusSection(counterRef)}>查看反方</button>
          </div>

          <section className="bridge-checks" aria-label="证据和反方">
            <div ref={evidenceRef} tabIndex={-1}>
              <h3>需要补的证据</h3>
              {evidenceGaps.length ? <ul>{evidenceGaps.map((item, index) => <li key={`${item.claim}:${index}`}><b>{item.claim}</b>{item.needed ? <span>{item.needed}</span> : null}</li>)}</ul> : <p>当前没有发现明确证据缺口。</p>}
            </div>
            <div ref={counterRef} tabIndex={-1}>
              <h3>真正有力的反方</h3>
              {counterarguments.length ? <ul>{counterarguments.map((item, index) => <li key={`${item.claim}:${index}`}><b>{item.claim}</b>{item.response ? <span>{item.response}</span> : null}</li>)}</ul> : <p>当前还没有生成有力反方。</p>}
            </div>
          </section>

          <footer className="bridge-result-footer">
            {savedOpportunity ? (
              <Note title="内容机会已保存">这条连接已经写入本地工作区，重启后仍可继续发展。</Note>
            ) : (
              <Note title="目前仍是候选">预览不会创建项目、修改知识库或写入正文。只有你确认保存后，才会写入内容机会。</Note>
            )}
            {savedOpportunity ? (
              <button type="button" className="btn btn-primary" disabled={projectBusy} onClick={createProject}>{projectBusy ? "正在建立项目…" : "建立内容项目"}</button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={saveBusy} onClick={saveOpportunity}>
                {saveBusy ? "正在保存…" : "保存为内容机会"}
              </button>
            )}
          </footer>
        </div>
      ) : null}
    </div>
  );
}
