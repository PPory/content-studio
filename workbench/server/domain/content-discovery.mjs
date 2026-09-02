/**
 * AI Discovery 的上下文、缓存与就绪判断。
 *
 * 这一层回答三个问题：**给模型看什么**、**什么时候可以复用上次的结果**、
 * **什么都没有的时候怎么老实说**。模型协议在 `content-discovery-ai.mjs`。
 *
 * ⚠️ **没有做 N×M 两两比较，也没有召回层。**
 * 实测 100 个 Wiki 页的 `title | page_type | summary` 索引一共约 5000 字符——
 * 在这个规模下，先检索再重排只是把一次便宜的调用换成一套要维护的基础设施，
 * 而且现有中文检索是 `LIKE` 匹配，本来就不能当语义召回用。
 * 等索引真的大到塞不下，再谈 Local Recall → Candidate Pool → Rerank。
 *
 * ⚠️ **原话和 Wiki 的预算规则不同。** Wiki 索引是摘要，全量给；
 * 而一段群聊可能就是几万字，所以只喂**还没被分析过的**那些，并且有总量上限。
 * 已经分析过的原话由它产出的 Audience Problem 代表，不重复发。
 */

import { gradeProblemEvidence } from "./audience-raw.mjs";
import { recentResearchSignals } from "./assistant-signals.mjs";
import { sha256Json } from "./integrity.mjs";

/** 一次扫描最多喂给模型多少字符的原话。超出的截断并如实标注。 */
const RAW_BUDGET = 24_000;
/** 单段原话最多喂多少字符。一段超长转写不该把预算一个人吃完。 */
const RAW_ITEM_LIMIT = 6_000;
/** 没有新原话时，回头看最近几段——否则「重新扫描」永远是空的。 */
const RAW_FALLBACK_COUNT = 5;
/** 每条问题最多带几句原话进上下文。 */
const QUOTES_PER_PROBLEM = 3;

const CACHE_KEY = "content-discovery:last";

const clean = (value, max = 4_000) => String(value ?? "").trim().slice(0, max);

function truncate(text, limit) {
  const body = String(text ?? "");
  if (body.length <= limit) return { text: body, truncated: false };
  return { text: `${body.slice(0, limit)}…`, truncated: true };
}

/**
 * 缓存指纹。
 *
 * ⚠️ **必须包含原始声音，而且必须包含条数。** 只看各表的 max(updated_at) 的话，
 * 用户刚粘完一段群聊、页面却还在显示上一次扫描——那正是这套缓存最容易犯的错。
 * 而只看时间不看条数，同一秒内粘进来的第二段会被当成「没有变化」。
 */
export function discoveryFingerprint(workspace, { agendaId = "", focus = "" } = {}) {
  const one = (sql) => workspace.db.prepare(sql).get();
  const wiki = one(`SELECT COUNT(*) AS total, MAX(p.updated_at) AS latest FROM wiki_pages p
    JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL`);
  const problems = one(`SELECT COUNT(*) AS total, MAX(p.updated_at) AS latest FROM audience_problems p
    JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE p.status='active'`);
  const agendas = one(`SELECT COUNT(*) AS total, MAX(a.updated_at) AS latest FROM content_agendas a
    JOIN entities e ON e.id=a.id AND e.deleted_at IS NULL WHERE a.status='active'`);
  const voices = workspace.audienceRaw.stats();
  /**
   * ⚠️ 最近聊过什么也算输入的一部分：聊完一轮新方向回来，
   * 缓存不失效的话，页面会继续显示一份没看过这些的旧扫描。
   */
  const research = workspace.db.prepare(`SELECT COUNT(*) AS total, MAX(e.updated_at) AS latest
    FROM ai_conversations c JOIN entities e ON e.id = c.id AND e.deleted_at IS NULL
    WHERE c.archived_at IS NULL`).get();
  return sha256Json({
    wiki: { total: wiki.total, latest: wiki.latest || "" },
    problems: { total: problems.total, latest: problems.latest || "" },
    agendas: { total: agendas.total, latest: agendas.latest || "" },
    /**
     * ⚠️ **不放 `pending`。** 扫描自己会把读过的原话标成已分析，
     * 于是 pending 一定会变——把它算进指纹，等于每次扫描完成的那一刻
     * 就宣告自己的结果过期了。真正表示「有新东西」的是条数和最新导入时间。
     */
    voices: { total: voices.total, latest: voices.latest },
    research: { total: research.total || 0, latest: research.latest || "" },
    agendaId: clean(agendaId, 120),
    focus: clean(focus, 500),
  });
}

/**
 * 扫描要读的东西。
 *
 * 全部都是**轻量索引或原话**，没有 Wiki 正文：正文在深入分析那一步才需要，
 * 而深入分析是针对已经被选中的那一条做的。
 */
export function buildDiscoveryContext(workspace, { agendaId = "", focus = "" } = {}) {
  const db = workspace.db;

  const wikiPages = db.prepare(`SELECT p.id,p.title,p.page_type AS pageType,p.summary,p.updated_at AS updatedAt
    FROM wiki_pages p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL
    ORDER BY p.updated_at DESC, p.title`).all();

  const problems = workspace.contentBridge.audienceProblems().map((problem) => {
    const evidence = gradeProblemEvidence(db, problem);
    return {
      id: problem.id,
      statement: problem.statement,
      summary: problem.summary,
      origin: problem.origin,
      pattern: problem.pattern,
      updatedAt: problem.updatedAt,
      evidenceGrade: evidence.grade,
      evidenceLabel: evidence.label,
      evidenceNote: evidence.note,
      quotes: evidence.quotes.slice(0, QUOTES_PER_PROBLEM).map((item) => ({
        rawSourceId: item.rawId,
        quote: item.quote,
        sourceName: item.sourceName,
        observedAt: item.observedAt,
      })),
    };
  });

  const pending = workspace.audienceRaw.sources({ limit: 40, pendingOnly: true });
  /**
   * 一段新原话都没有时回头看最近几段。
   * 不这样做的话「重新扫描」在第二次点的时候现实侧就是空的，
   * 而那不是事实——那些原话还在，只是上次读过了。
   */
  const pool = pending.length ? pending : workspace.audienceRaw.sources({ limit: RAW_FALLBACK_COUNT });
  const voices = [];
  let spent = 0;
  for (const item of pool) {
    if (spent >= RAW_BUDGET) break;
    const room = Math.min(RAW_ITEM_LIMIT, RAW_BUDGET - spent);
    const body = truncate(item.body, room);
    spent += body.text.length;
    voices.push({
      id: item.id,
      kind: item.kind,
      kindLabel: item.kindLabel,
      sourceName: item.sourceName,
      observedAt: item.observedAt,
      body: body.text,
      truncated: body.truncated,
      analyzedAt: item.analyzedAt,
    });
  }

  const agendas = workspace.contentBridge.agendas();
  const agenda = agendaId ? agendas.find((item) => item.id === agendaId) || null : null;

  /**
   * 最近在 AI 助手里聊过什么。
   *
   * ⚠️ **它只决定往哪儿看，不决定什么是真的。**
   * 而且它只包含创作者自己打的字——助手说过的话在 `assistant-signals.mjs`
   * 里就被丢掉了，到不了这里。知识还是要回到 Wiki，证据还是要回到原话。
   */
  const research = recentResearchSignals(workspace);

  return {
    wikiPages,
    problems,
    voices,
    agendas,
    agenda,
    research,
    focus: clean(focus, 500),
    // 有多少张 Wiki、多少条问题、几段原话真的进了这次上下文——回执要说得出来。
    read: {
      wikiPages: wikiPages.length,
      problems: problems.length,
      voices: voices.length,
      researchThreads: research.length,
      pendingVoices: pending.length,
      reusedVoices: pending.length ? 0 : voices.length,
      voiceChars: spent,
    },
    fingerprint: discoveryFingerprint(workspace, { agendaId, focus }),
  };
}

/**
 * 这次扫描有没有东西可看。
 *
 * ⚠️ **知识侧空着和现实侧空着是两种「没有」**，给的下一步也不同：
 * 没有 Wiki 就该去编译知识，没有现实声音就该去导入原话或从议程推导。
 * 一句笼统的「暂无数据」会让人不知道该干什么。
 */
export function discoveryReadiness(context) {
  const knowledge = context.wikiPages.length > 0;
  const reality = context.voices.length > 0 || context.problems.length > 0;
  if (knowledge && reality) return { ready: true, reason: "", missing: [] };
  const missing = [];
  if (!knowledge) missing.push("knowledge");
  if (!reality) missing.push("reality");
  return {
    ready: false,
    missing,
    reason: !knowledge && !reality
      ? "工作台里还没有可用的知识，也还没有任何真实用户声音。"
      : !knowledge
        ? "还没有编译出可用的 Wiki 知识，连接的一头是空的。"
        : "还没有任何真实用户声音或已确认的用户问题，连接的另一头是空的。",
  };
}

export function readDiscoveryCache(workspace) {
  const cached = workspace.repository.getSetting(CACHE_KEY, null);
  if (!cached || typeof cached !== "object") return null;
  return cached;
}

export function writeDiscoveryCache(workspace, value, { now } = {}) {
  workspace.repository.setSetting(CACHE_KEY, value, { now });
  return value;
}

/**
 * 缓存还能不能直接用。
 *
 * 返回的是**为什么不能用**，不只是一个布尔——界面要说出「你之后又粘了 2 段原话」，
 * 而不是干巴巴地重新跑一遍。
 */
export function discoveryCacheState(workspace, { agendaId = "", focus = "" } = {}) {
  const cached = readDiscoveryCache(workspace);
  if (!cached) return { cached: null, stale: true, reason: "还没有扫描过" };
  const fingerprint = discoveryFingerprint(workspace, { agendaId, focus });
  if (cached.fingerprint === fingerprint) return { cached, stale: false, reason: "" };
  const voices = workspace.audienceRaw.stats();
  const added = voices.total - (cached.read?.voiceTotalAtScan ?? voices.total);
  return {
    cached,
    stale: true,
    reason: added > 0 ? `上次扫描之后又记了 ${added} 段原话` : "知识、用户问题或议程有更新",
  };
}
