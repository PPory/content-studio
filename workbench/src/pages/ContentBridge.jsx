import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, Note, SearchBox } from "../components/ui.jsx";
import { peekDiscoveryHandoff } from "../lib/discovery-handoff.js";
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

/**
 * 路由状态 → 这一页此刻是**概览**还是**工作台**。
 *
 * ⚠️ 这两件事以前挤在同一屏：一进来先看到大标题、说明文案、已保存机会列表，
 * 然后才是两栏选择器和结果。可它们的节奏完全不同——概览回答「我该继续哪一条」，
 * 工作台回答「这一条到底能不能连」。挤在一起的结果是每次做新连接都要先滚过
 * 一堆自己已经做完的东西，而读结果时头顶还挂着一个跟当前无关的列表。
 */
function initialIds(value) {
  const text = String(value || "");
  const workspace = { wikiId: "", problemId: "", opportunityId: "", develop: false };
  if (text.startsWith("wiki:")) return { ...workspace, wikiId: text.slice(5) };
  if (text.startsWith("problem:")) return { ...workspace, problemId: text.slice(8) };
  if (text.startsWith("opportunity:")) return { ...workspace, opportunityId: text.slice(12) };
  /**
   * 从构造工作台点「查看完整分析」过来：候选在内存交接里，不进 hash 也不进库。
   * ⚠️ 旧的 `develop` 落点仍然认——它现在归构造工作台，这里留着只为老链接不炸。
   */
  if (text === "analyze" || text === "develop") return { ...workspace, develop: true };
  return workspace;
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

/**
 * 建议程的表单。第 02 栏（开始之前定议程）和结果第 5 段（写到一半想起要关联）共用一份。
 *
 * ⚠️ 这个表单原来只长在结果第 5 段里，也就是**必须先选 Wiki、选问题、跑完一次 AI**
 * 才看得到。而议程按定义是开始之前就该定的东西——那个位置让它永远建不起来。
 */
function AgendaQuickForm({ title, judgment, onTitle, onJudgment, busy, onSubmit }) {
  return (
    <div className="bridge-agenda-create">
      <label>名称<input value={title} onChange={(event) => onTitle(event.target.value)} placeholder="例如：保留人的判断权" /></label>
      <label>希望用户最终形成什么判断<textarea rows={2} value={judgment} onChange={(event) => onJudgment(event.target.value)} placeholder="写出长期希望受众形成的稳定判断" /></label>
      <button type="button" className="btn btn-primary btn-sm" disabled={!title.trim() || !judgment.trim() || busy} onClick={onSubmit}>{busy ? "正在创建…" : "确认创建"}</button>
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
  /** 工作区有没有可核验的个人经历。没有就不摆「经历型」那颗按钮。 */
  const [experienceAvailable, setExperienceAvailable] = useState(false);
  const [agendas, setAgendas] = useState([]);
  const [insights, setInsights] = useState([]);
  const [agendaError, setAgendaError] = useState(null);
  const [insightsError, setInsightsError] = useState(null);
  const [agendaFitBusy, setAgendaFitBusy] = useState(false);
  const [wikiId, setWikiId] = useState(initial.wikiId);
  const [problemId, setProblemId] = useState(initial.problemId);
  /**
   * 从 AI 发现「发展这条」带过来的用户问题候选。
   *
   * ⚠️ **它还没有入库，而且在用户点「保存为内容机会」之前一直不会入库。**
   * 先建 audience_problem 再谈连接，等于让每一次好奇心都在问题库里留一条垃圾。
   */
  const [problemCandidate, setProblemCandidate] = useState(null);
  /** 「发展这条」进来之后自动跑一次预览：用户已经表达过要看这一条，不该再点一次。 */
  const [autoPreview, setAutoPreview] = useState(false);
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
  const [extractionNote, setExtractionNote] = useState("");
  /**
   * 有结果时选择区塌成一行。
   *
   * ⚠️ 这不是「折叠一个次要区块」，是这一页有两种模式：还没连接时你在**选**，
   * 选完之后你在**读和决定**。两栏选择区是 1000px，结果整个落在第二屏以下——
   * 点完按钮要先滚过自己刚做完的事才看得见答案。塌起来之后结果直接顶到第一屏。
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [agendaFormOpen, setAgendaFormOpen] = useState(false);
  const [agendaFormAtPicker, setAgendaFormAtPicker] = useState(false);
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
    const [wikiResult, problemResult, agendaResult, insightResult, opportunityResult] = await Promise.allSettled([
      api.wiki(),
      api.audienceProblems(),
      api.agendas(),
      api.workspaceInsights(),
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
      setExperienceAvailable(problemData.experienceAvailable === true);
      setAgendas(agendaData.agendas || []);
      setInsights(insightData.reports || []);
      if (agendaResult.status === "rejected") setAgendaError(agendaResult.reason);
      if (insightResult.status === "rejected") setInsightsError(insightResult.reason);
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
      } else if (requested.develop) {
        /**
         * 从 AI 发现「发展这条」进来。
         *
         * ⚠️ **候选从内存交接里取，取完即清。** 它没有 id，也不该有——
         * 用户可能看两眼就放弃，那种放弃不该在问题库里留下任何东西。
         * 刷新页面候选就没了，这是对的：那时它已经不是「刚发现的这一条」了。
         */
        /**
         * ⚠️ 用 `peek` 不用 `take`：构造工作台和这份完整分析之间要能来回走。
         * 取完即清的话，从这儿返回构造页就变成「这条连接已经不在手边了」——
         * 而它明明还在屏幕上。真正让它失效的是刷新，那是对的。
         */
        const handoff = peekDiscoveryHandoff();
        if (!handoff) {
          setWikiId("");
          setProblemId("");
          setProblemCandidate(null);
          setPreview(null);
          setSavedOpportunity(null);
        } else {
          const anchor = handoff.knowledgeAnchors?.[0]?.wikiPageId || "";
          const candidate = handoff.problem.existingProblemId ? null : {
            statement: handoff.problem.statement,
            summary: handoff.problem.whyItMatters,
            origin: handoff.problem.origin,
            // ⚠️ 假设的来源议程由候选自己带过来，别在这里随手拿第一条顶上：
            // 那会把「从 A 议程推导的假设」记成 B 议程推导的。
            originAgendaId: handoff.problem.originAgendaId || "",
            evidence: (handoff.problem.evidence || []).map((item) => ({ rawSourceId: item.rawSourceId, quote: item.quote })),
          };
          setWikiId(anchor);
          setProblemId(handoff.problem.existingProblemId || "");
          setProblemCandidate(candidate);
          setAgendaId(handoff.agendaSuggestion?.agendaId || handoff.problem.originAgendaId || (agendaData.agendas || [])[0]?.id || "");
          setPreview(null);
          setSavedOpportunity(null);
          setPickerOpen(false);
          setAutoPreview(Boolean(anchor));
        }
      } else {
        setWikiId(requested.wikiId);
        setProblemId(requested.problemId);
        setProblemCandidate(null);
        /**
         * ⚠️ 默认选中最近更新的那条议程，不留空。
         * 留空的代价是「从议程拎问题」一进页面就是灰的，而灰掉的原因（还没选议程）
         * 界面上一个字都没说——真实跑的时候我就在这儿卡住过。议程一共两三条、
         * 长期不变，猜最近那条几乎总是对的，猜错了下拉框就在旁边。
         */
        setAgendaId((agendaData.agendas || [])[0]?.id || "");
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
  /** 已入库的问题和候选二选一，下面一律用这个统一读。 */
  const activeProblem = selectedProblem || problemCandidate || null;
  const hasProblem = Boolean(problemId || problemCandidate);

  /**
   * 「发展这条」进来之后自动跑一次预览。
   *
   * ⚠️ **必须排在 `hasProblem` 之后**：依赖数组是在渲染时求值的，
   * 放在它前面会直接 TDZ 报错——真实浏览器里表现为整页白屏，而构建不报错。
   */
  useEffect(() => {
    if (!autoPreview || previewBusy || preview || !wikiId || !hasProblem) return;
    setAutoPreview(false);
    runPreview();
  }, [autoPreview, previewBusy, preview, wikiId, hasProblem]);
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
    setProblemCandidate(null);
    resetPreview();
  };

  const runPreview = async ({ dominantAction = "", agendaOverride } = {}) => {
    if (!wikiId || !hasProblem) return;
    setPickerOpen(false);
    setPreviewBusy(true);
    setPreviewError(null);
    setSavedOpportunity(null);
    const effectiveAgendaId = agendaOverride === undefined ? agendaId : agendaOverride;
    try {
      const result = await api.previewContentOpportunity({
        wikiPageId: wikiId,
        audienceProblemId: problemId || undefined,
        problemCandidate: problemCandidate || undefined,
        agendaId: effectiveAgendaId || undefined,
        dominantAction: dominantAction || undefined,
      });
      setPreview(result.candidate);
      setEntryIndex(0);
      setPickerOpen(false);
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
        audienceProblemId: problemId || undefined,
        problemCandidate: problemCandidate || undefined,
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
      setAgendaFormAtPicker(false);
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
    if (!preview || !wikiId || !hasProblem) return;
    setSaveBusy(true);
    setPreviewError(null);
    try {
      const result = await api.saveContentOpportunity({
        wikiPageId: wikiId,
        audienceProblemId: problemId || undefined,
        // 保存这一刻，候选问题和内容机会一起进同一个事务。
        problemCandidate: problemCandidate || undefined,
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
      // 候选已经落库，后面的动作都以库里那条为准。
      if (problemCandidate) {
        setProblemCandidate(null);
        setProblemId(result.opportunity.audienceProblemId);
      }
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
        // 标题交给领域层按用户问题生成，前端不再把整句核心判断塞进去
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
    setExtractionNote("");
    try {
      const result = await api.extractAudienceProblems(insight.id);
      const problems = result.problems || [];
      setExtraction(problems);
      if (!problems.length) setExtractionNote("这份洞察里没有读出值得记的用户问题。");
    } catch (failure) {
      setPreviewError(failure);
    } finally {
      setExtractBusy(false);
    }
  };

  /**
   * 从议程「拎出一层」：这条议程覆盖的问题空间里，受众可能正在困惑什么。
   *
   * 产出的是**假设**，不是观察——它没有来源，保存时以 origin=hypothesis 永久标注。
   * 这是问题库唯一不依赖外部抓取的供给路径。
   */
  const deriveProblems = async () => {
    if (!agendaId) return;
    setExtractBusy(true);
    setPreviewError(null);
    setExtractionNote("");
    try {
      const result = await api.agendaProblemCandidates(agendaId);
      const problems = result.problems || [];
      setExtraction(problems);
      if (!problems.length) setExtractionNote("这个议程暂时没拎出值得记的问题。把议程写得更具体，或者自己记一个真实听到的问题。");
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
  // 一开始判断就塌起来：等待提示要落在结果将要出现的地方，而不是被顶到折叠线以下。
  const pickerCollapsed = (Boolean(preview) || previewBusy) && !pickerOpen;

  const problemsPanel = (pickable) => (
    <section className="bridge-problems" aria-labelledby="bridge-problem-title">
      <div className="bridge-panel-head">
        <h3 id="bridge-problem-title">用户在困惑什么</h3>
        <small>{problems.length ? `${problems.length} 条` : "议程 / 洞察 / 反馈"}</small>
      </div>
          {/*
            ⚠️ 议程在这里，不在结果第 5 段里。
            问题库空着的时候，用户此刻最该做的一件事是把议程拎成问题，
            所以那颗按钮在这种状态下才是主动作；有问题可选之后它退级。
          */}
          <div className="bridge-side-actions">
            {agendas.length ? (
              <>
                <select
                  className="bridge-agenda-pick"
                  aria-label="选择长期议程"
                  value={agendaId}
                  disabled={extractBusy}
                  onChange={(event) => selectAgenda(event.target.value)}
                >
                  <option value="">选一个长期议程</option>
                  {agendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.title}</option>)}
                </select>
                <button
                  type="button"
                  className={`btn btn-sm${problems.length ? "" : " btn-primary"}`}
                  disabled={extractBusy || !agendaId}
                  onClick={deriveProblems}
                >
                  {extractBusy ? "正在拎问题…" : "从议程拎问题"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`btn btn-sm${problems.length ? "" : " btn-primary"}`}
                onClick={() => setAgendaFormAtPicker((value) => !value)}
              >
                先定一个议程
              </button>
            )}
            {insights.length ? (
              <button type="button" className="btn btn-sm" disabled={extractBusy} onClick={extractProblems}>
                {extractBusy ? "正在提取…" : `从《${latestInsight?.title || latestInsight?.week || "最近洞察"}》提取`}
              </button>
            ) : null}
            <button type="button" className="btn btn-sm" onClick={() => setManualOpen((value) => !value)}>自己记一个问题</button>
          </div>
          {agendaFormAtPicker ? (
            <AgendaQuickForm
              title={agendaTitle}
              judgment={agendaJudgment}
              onTitle={setAgendaTitle}
              onJudgment={setAgendaJudgment}
              busy={agendaCreateBusy}
              onSubmit={createAgenda}
            />
          ) : null}
          {latestInsight ? <p className="bridge-insight-source">读取报告：{latestInsight.title || latestInsight.week || "最近洞察"}{latestInsight.generatedAt ? ` · ${dateLabel(latestInsight.generatedAt)}` : ""}</p> : null}
          {insightsError ? <p className="bridge-local-error">洞察报告暂时无法读取。你仍可选择已有问题或自己记录。</p> : null}
          {manualOpen ? (
            <div className="bridge-manual-form">
              <label>用户正在困惑什么<textarea value={manualStatement} onChange={(event) => setManualStatement(event.target.value)} rows={3} placeholder="写成一个真实问题，而不是热点标题" /></label>
              <label>为什么值得关注<textarea value={manualSummary} onChange={(event) => setManualSummary(event.target.value)} rows={2} placeholder="可选" /></label>
              <button type="button" className="btn btn-primary" disabled={!manualStatement.trim() || saveBusy} onClick={saveManual}>{saveBusy ? "正在保存…" : "确认保存"}</button>
            </div>
          ) : null}
          {/*
            ⚠️ 拎问题要 8 秒上下。原来这段时间里全页唯一的变化是那颗小按钮换了行字，
            真实用起来完全不知道它在不在动。等待要占住结果将要出现的位置，
            并且说清楚要等多久、等出来的是什么。
          */}
          {extractBusy ? (
            <div className="bridge-pending" aria-live="polite">
              <p>正在{selectedAgenda ? `从「${selectedAgenda.title}」` : ""}拎出可能的用户问题…</p>
              <small>通常十几秒。拎出来的是候选，你逐条确认之后才会保存。</small>
            </div>
          ) : null}
          {extractionNote ? <p className="bridge-insight-source">{extractionNote}</p> : null}
          {extraction.length ? (
            <div className="bridge-candidates" aria-label="待确认的用户问题候选">
              <p>一个可能的用户问题</p>
              {extraction.map((candidate) => (
                <article key={`${candidate.origin || "observed"}:${candidate.statement}`}>
                  <strong>{candidate.statement}</strong>
                  <span>{candidate.whyItMatters}</span>
                  {/* 议程推导的候选没有来源，标注必须说清楚它还没被任何人真的问过。 */}
                  <small>
                    {candidate.origin === "hypothesis"
                      ? "议程推导 · 尚无真实观察"
                      : `来自最近洞察 · ${PATTERN_LABELS[candidate.pattern] || candidate.pattern}`}
                  </small>
                  <button type="button" className="btn btn-sm" disabled={saveBusy} onClick={() => confirmCandidate(candidate)}>确认保存</button>
                </article>
              ))}
            </div>
          ) : null}
          <div className="bridge-side-list bridge-side-list--problems">
            {/*
              ⚠️ 候选钉在最上面并且标明「还没保存」。
              它看起来和下面已入库的问题一样可选，但它此刻还不在库里——
              不说清楚的话，用户会以为自己已经把它记下来了。
            */}
            {problemCandidate ? (
              <div className="bridge-side-candidate" aria-label="来自 AI 发现的用户问题候选">
                <strong>{problemCandidate.statement}</strong>
                {problemCandidate.summary ? <p>{problemCandidate.summary}</p> : null}
                <small>
                  {problemCandidate.origin === "hypothesis"
                    ? "还没保存 · 你认为可能有人这样困惑，尚待验证"
                    : `还没保存 · ${problemCandidate.evidence.length} 段真实原话`}
                </small>
                <button type="button" className="btn btn-sm" onClick={() => { setProblemCandidate(null); resetPreview(); }}>换一个问题</button>
              </div>
            ) : null}
            {!problems.length ? (
              <EmptySide>
                {agendas.length
                  ? "还没有用户问题。先选一个长期议程，把它覆盖的困惑拎出来。"
                  : "还没有用户问题。先定一个长期议程——你希望受众最终形成什么判断，决定了他们的哪些困惑值得你回答。"}
              </EmptySide>
            ) : problems.map((problem) => (
              <SelectionRow key={problem.id} selected={pickable && problemId === problem.id} onClick={() => (pickable ? selectProblem(problem.id) : onGo?.("bridge", `problem:${problem.id}`))} ariaLabel={`选择用户问题：${problem.statement}`}>
                <strong>{problem.statement}</strong>
                <p>{problem.summary || "这条问题还没有补充说明。"}</p>
                {/* 假设没有来源，显示「0 个来源」会读成「来源丢了」，是两回事。 */}
                <small>
                  {problem.origin === "hypothesis"
                    ? "议程推导 · 待验证"
                    : <><SourceCount count={problem.sources?.length} /> · {PATTERN_LABELS[problem.pattern] || "反馈"}</>}
                </small>
              </SelectionRow>
            ))}
          </div>
    </section>
  );

  return (
    <div className="view-body content-bridge">
      {/* 工作台的顶栏是常驻操作区：滚到结果哪一段，主动作都还在手边 */}
      <div className="bridge-bar bridge-bar--sticky">
        <button type="button" className="bridge-back" onClick={() => onGo?.("bridge", "")}>← 内容</button>
        <div className="bridge-bar__title">
          {selectedWiki || activeProblem ? (
            <h2>
              <span>{selectedWiki?.title || "选一个知识"}</span>
              <em aria-hidden="true">×</em>
              <span>{activeProblem?.statement || "选一个用户问题"}</span>
            </h2>
          ) : <h2>新建连接</h2>}
          {/*
            ⚠️ **「还没保存」要留在常驻顶栏里，不能只写在下面那张候选卡上。**
            有结果之后选择区整个塌起来，那张卡就从屏幕上消失了——
            而这正是用户要按「保存为内容机会」的时刻，他必须知道这条问题
            此刻还不在问题库里，按下去才是它第一次入库。
          */}
          {problemCandidate ? <span className="bridge-bar__pending">用户问题还没保存</span> : null}
        </div>
        <div className="bridge-bar__actions">
          {preview ? <span className="bridge-fit" data-fit={preview.fit}>{FIT_LABELS[preview.fit] || preview.fit}</span> : null}
          {preview && !savedOpportunity ? (
            <button type="button" className="btn btn-sm" onClick={() => setPickerOpen((value) => !value)}>{pickerOpen ? "收起选择" : "重新选择"}</button>
          ) : null}
          {!preview ? (
            <button type="button" className="btn btn-primary" disabled={previewBusy || !wikiId || !hasProblem} onClick={() => runPreview()}>
              {previewBusy ? "正在判断连接…" : "看看怎么连接"}
            </button>
          ) : savedOpportunity ? (
            <button type="button" className="btn btn-primary" disabled={projectBusy} onClick={createProject}>{projectBusy ? "正在建立项目…" : "建立内容项目"}</button>
          ) : preview.fit === "weak" ? (
            <button type="button" className="btn btn-primary" onClick={() => setPickerOpen(true)}>换一个知识或问题</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={saveBusy} onClick={saveOpportunity}>{saveBusy ? "正在保存…" : "保存为内容机会"}</button>
          )}
        </div>
      </div>

      {pickerCollapsed ? null : (
        <div className="bridge-picker" aria-label="选择知识和用户问题">
        <section className="bridge-side" aria-labelledby="bridge-wiki-title">
          {/* 01/02 的编号取消了：两栏不再是一个仪式化的对称装置，就是选左边和选右边 */}
          <div className="bridge-panel-head">
            <h3 id="bridge-wiki-title">我搞懂了什么</h3>
            <small>{wikiPages.length} / {wikiData?.pages?.length || 0} 条长期知识</small>
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
          {problemsPanel(true)}
        </div>
      )}

      {!pickerCollapsed && !(wikiId && hasProblem) ? (
        <p className="bridge-hint">从两边各选一个对象，系统才会判断它们是否真的能连接。</p>
      ) : null}

      {previewBusy ? (
        <div className="bridge-pending bridge-pending--result" aria-live="polite">
          <p>正在判断这两者能不能连接…</p>
          <small>会依次得到：用户真正的问题、你的知识能提供什么解释、最大的认知差、核心判断。通常十几秒。</small>
        </div>
      ) : null}

      {previewError ? <ErrorNote error={previewError} what="内容连接" onRetry={wikiId && hasProblem ? () => runPreview() : undefined} /> : null}

      {preview ? (
        <div className="bridge-result" data-fit={preview.fit}>
          <div className="bridge-result-head">
            <div><span className="bridge-fit">{FIT_LABELS[preview.fit] || preview.fit}</span><p>{preview.fitReason}</p></div>
            {preview.fit === "weak" ? <strong>不建议硬做内容</strong> : null}
          </div>

          <ResultSection index={1} title="用户真正的问题">
            <p>{preview.audienceProblem.underlying}</p>
            {/* 从已保存机会还原时表层和深层都回落成同一句问题，重复显示会读成出错 */}
            {preview.audienceProblem.surface && preview.audienceProblem.surface !== preview.audienceProblem.underlying
              ? <small>表层表现：{preview.audienceProblem.surface}</small>
              : null}
          </ResultSection>
          <ResultSection index={2} title="我的知识能提供什么解释"><p>{preview.knowledgeExplanation}</p></ResultSection>
          <ResultSection index={3} title="最大的认知差"><p>{preview.cognitiveGap}</p></ResultSection>
          <ResultSection index={4} title="核心判断"><blockquote>{preview.coreClaim}</blockquote></ResultSection>
          {/*
            ⚠️ 议程不编号。01–04 是**读**的东西（问题 → 解释 → 认知差 → 判断，
            这个顺序是产品原则，不要倒过来把标题提前），而这里是一个**决定**：
            这条判断要归到哪条长期议程底下。混在编号流里，一个下拉框会被读成
            「第 5 段正文」——整页就从文章退化成清单。
          */}
          <section className="bridge-result-agenda" aria-label="长期议程">
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
              <AgendaQuickForm
                title={agendaTitle}
                judgment={agendaJudgment}
                onTitle={setAgendaTitle}
                onJudgment={setAgendaJudgment}
                busy={agendaCreateBusy}
                onSubmit={createAgenda}
              />
            ) : null}
          </section>
          <ResultSection index={5} title="怎么讲">
            <ol className="bridge-storyline">
              <li><span>①</span><div><b>从什么现实问题进入</b><p>{activeEntry?.text || preview.audienceProblem.surface}</p>{activeEntry?.scope_check?.status === "too_broad" ? <em>范围过大：{activeEntry.scope_check.reason}</em> : null}</div></li>
              <li><span>②</span><div><b>用什么知识解释</b><p>{preview.knowledgeExplanation}</p></div></li>
              <li><span>③</span><div><b>哪些东西形成关系</b><p>{(construction.relations || []).map((item) => `${RELATION_LABELS[item.type] || item.type}：${item.explanation}`).filter(Boolean).join("；") || "当前还没有足够自然的关系。"}</p></div></li>
              <li><span>④</span><div><b>最终留下什么判断</b><p>{preview.coreClaim}</p></div></li>
            </ol>
          </ResultSection>

          <div className="bridge-action-bar" aria-label="调整内容连接">
            {/* 灰掉必须说明为什么：这次只生成了一个入口，没有可换的 */}
            <button
              type="button"
              disabled={entryOptions.length < 2}
              title={entryOptions.length < 2 ? "这次只给出了一个大众入口，没有别的可换" : `共 ${entryOptions.length} 个入口`}
              onClick={() => setEntryIndex((value) => (value + 1) % entryOptions.length)}
            >换一个大众入口</button>
            <div className="bridge-action-menu">
              <span>换一种表达方式</span>
              {ACTIONS.filter((action) => action.key !== "experience" || experienceAvailable).map((action) => <button key={action.key} type="button" aria-pressed={preview.dominantAction === action.key} disabled={previewBusy} onClick={() => runPreview({ dominantAction: action.key })}>{action.label}</button>)}
            </div>
            {/*
              这两颗是**跳到本页下面某处**，上面两组是**改变候选**。
              混在一条里读起来全是「按钮」，分不清哪个会重算、哪个只是滚动。
            */}
            <div className="bridge-action-jump">
              <button type="button" onClick={() => focusSection(evidenceRef)}>查看证据缺口</button>
              <button type="button" onClick={() => focusSection(counterRef)}>查看反方</button>
            </div>
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

          {/*
            ⚠️ 弱连接时主动作是**换一个**，不是保存。
            系统刚说完「不建议硬做内容」，底下再摆一颗黑色的「保存为内容机会」，
            判断和引导就是互相矛盾的——真实跑的时候我一路顺着主按钮就把一条
            自己判断为弱的连接存下去了。保存仍然留着，但退成次级：决定权还是用户的。
          */}
          {/*
            ⚠️ 底部不再重复主动作——它已经常驻在顶栏，滚到哪儿都在手边。
            这里只说明当前是什么状态；弱连接时多给一条次级出口，
            因为「仍然要做」是个需要多想一秒的决定，不该和主动作并排。
          */}
          <footer className="bridge-result-footer" data-fit={preview.fit}>
            {savedOpportunity ? (
              <Note title="内容机会已保存">这条连接已经写入本地工作区，重启后仍可继续发展。</Note>
            ) : preview.fit === "weak" ? (
              <>
                <Note title="不建议在这条连接上硬做">换一个知识，或者换一个用户问题，通常比把这条硬撑成文章划算。</Note>
                <button type="button" className="btn" disabled={saveBusy} onClick={saveOpportunity}>
                  {saveBusy ? "正在保存…" : "仍然保存为内容机会"}
                </button>
              </>
            ) : (
              <Note title="目前仍是候选">预览不会创建项目、修改知识库或写入正文。只有你确认保存后，才会写入内容机会。</Note>
            )}
          </footer>
        </div>
      ) : null}
    </div>
  );
}
