/**
 * 原始用户声音：现实世界证据的不可变入口。
 *
 * ⚠️ **这里只保存原话，不产生任何判断。** 一段群聊不是一个 Audience Problem，
 * 它只是「有人这样说过」。从中读出问题是 AI 的事，而且读出来的仍然只是候选。
 *
 * ⚠️ **域层不提供任何修改正文的方法**，storage 层还有一个触发器兜底。
 * 证据可改的话，逐字定位就不证明任何事了。录错请新增一条。
 */

import crypto from "node:crypto";
import { createUlid } from "../storage/ids.mjs";
import { sourceContainsVerbatim } from "./integrity.mjs";

/** 证据行指回本表用的前缀。和 `insight:` / `agenda:` / `experiment:` 是同一套约定。 */
export const RAW_SOURCE_REF_PREFIX = "raw:";

export const AUDIENCE_RAW_KINDS = Object.freeze([
  { key: "group_chat", label: "群聊" },
  { key: "comment", label: "评论" },
  { key: "direct_message", label: "私信" },
  { key: "interview", label: "访谈" },
  { key: "feedback", label: "反馈" },
  { key: "post", label: "帖子" },
  { key: "other", label: "其他" },
]);

const KIND_SET = new Set(AUDIENCE_RAW_KINDS.map((item) => item.key));
const KIND_LABELS = Object.fromEntries(AUDIENCE_RAW_KINDS.map((item) => [item.key, item.label]));

/**
 * 原始声音种类 → `audience_problems.source_kind` 的粗粒度取值。
 *
 * ⚠️ **这一列不是真正的出处**，真正的出处是证据行里的 `raw:<id>`。
 * 之所以还要映射，是因为那一列是 STRICT 表上的 CHECK，不能加值（见 0015 migration）。
 * 群聊 / 私信 / 访谈都落到 `feedback`：它们确实都是「用户对我说的话」这一类。
 */
const PROBLEM_SOURCE_KIND = Object.freeze({
  group_chat: "feedback",
  comment: "comment",
  direct_message: "feedback",
  interview: "feedback",
  feedback: "feedback",
  post: "social_post",
  other: "manual",
});

const isoNow = (now = new Date()) => new Date(now).toISOString();
const clean = (value) => String(value ?? "").trim();

function required(value, label, max = Infinity) {
  const result = clean(value);
  if (!result) throw new TypeError(`${label}不能为空`);
  if (result.length > max) throw new TypeError(`${label}不能超过 ${max} 字`);
  return result;
}

function optional(value, label, max) {
  const result = clean(value);
  if (result.length > max) throw new TypeError(`${label}不能超过 ${max} 字`);
  return result;
}

function requireConfirmedUser({ actor, confirmed }, action) {
  if (actor !== "user") throw new Error(`${action}只能由用户执行`);
  if (confirmed !== true) throw new Error(`${action}必须来自用户明确确认`);
}

/**
 * 粘进来的正文只做**换行归一**，不做其他清洗。
 *
 * ⚠️ 别顺手 trim 每一行或压缩空行：群聊原文里「谁在什么时候说了什么」的分行
 * 本身就是证据的一部分，而逐字校验之后要拿这段文本去定位引用。
 */
export function normalizeRawBody(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function rawSourceRef(id) {
  return `${RAW_SOURCE_REF_PREFIX}${clean(id)}`;
}

export function isRawSourceRef(value) {
  return clean(value).startsWith(RAW_SOURCE_REF_PREFIX);
}

export function rawSourceIdFromRef(value) {
  const text = clean(value);
  return text.startsWith(RAW_SOURCE_REF_PREFIX) ? text.slice(RAW_SOURCE_REF_PREFIX.length) : "";
}

export function audienceRawKindLabel(kind) {
  return KIND_LABELS[clean(kind)] || KIND_LABELS.other;
}

export function problemSourceKindForRawKind(kind) {
  return PROBLEM_SOURCE_KIND[clean(kind)] || "manual";
}

function rawDto(row) {
  return row && {
    id: row.id,
    kind: row.kind,
    kindLabel: audienceRawKindLabel(row.kind),
    body: row.body,
    contentSha256: row.content_sha256,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    observedAt: row.observed_at,
    ingestedAt: row.ingested_at,
    analyzedAt: row.analyzed_at || null,
    ref: rawSourceRef(row.id),
  };
}

const SELECT = `SELECT r.* FROM audience_raw_sources r
  JOIN entities e ON e.id = r.id AND e.deleted_at IS NULL`;

/**
 * 一条证据引用能不能落回真实原话。
 *
 * ⚠️ 用 `sourceContainsVerbatim`（NFKC + 空白归一）而不是裸 `includes`：
 * 粘进来的群聊里全角空格、零宽字符和换行随处可见，裸比对会把**真的原话**判成伪造。
 * 归一化不放宽「必须是原文里连续存在的一段」这条要求，它只是不因排版差异误伤。
 */
export function assertRawSourceEvidence(db, sourceId, evidenceText, label = "用户问题来源") {
  const id = rawSourceIdFromRef(sourceId);
  if (!id) throw new TypeError(`${label}不是原始用户声音引用`);
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id);
  if (!row) throw Object.assign(new Error(`${label}指向的原始用户声音不存在`), { status: 404 });
  if (!sourceContainsVerbatim(row.body, evidenceText)) {
    throw new Error(`${label}的原话无法在这段原始用户声音里逐字定位`);
  }
  return rawDto(row);
}

/**
 * 一条用户问题的**证据等级**。
 *
 * ⚠️ **不能只看 `origin='observed'`。** 这个仓库里历史上手工录入的问题也是 observed，
 * 而它唯一那条「证据」就是问题本身被复制了一遍——把它和一段真实群聊里的原话
 * 一起显示成「N 条真实反馈」，就是把人工记录冒充成观察。
 *
 * 三档的判据全部来自证据行本身：
 *   verbatim  证据指回不可变原始声音，且现在仍然逐字定位得到
 *   recorded  有证据行，但落不回原始声音（历史手工录入）
 *   hypothesis 没有任何证据行（议程推导）
 */
export const EVIDENCE_GRADES = Object.freeze({
  VERBATIM: "verbatim",
  RECORDED: "recorded",
  HYPOTHESIS: "hypothesis",
});

const EVIDENCE_LABELS = Object.freeze({
  verbatim: "真实原话",
  recorded: "人工记录",
  hypothesis: "议程假设",
});

export function evidenceGradeLabel(grade) {
  return EVIDENCE_LABELS[clean(grade)] || EVIDENCE_LABELS.recorded;
}

export function gradeProblemEvidence(db, problem) {
  const sources = Array.isArray(problem?.sources) ? problem.sources : [];
  if (problem?.origin === "hypothesis" || !sources.length) {
    return {
      grade: EVIDENCE_GRADES.HYPOTHESIS,
      label: EVIDENCE_LABELS.hypothesis,
      quotes: [],
      verbatimCount: 0,
      // ⚠️ 这句话会直接进模型上下文和界面，措辞就是那条真实性硬闸本身。
      note: "你认为这可能是一个受众问题，尚待真实反馈验证。",
    };
  }
  const quotes = [];
  for (const source of sources) {
    if (!isRawSourceRef(source.sourceId)) continue;
    try {
      const raw = assertRawSourceEvidence(db, source.sourceId, source.evidenceText, "用户问题来源");
      quotes.push({
        rawId: raw.id,
        kind: raw.kind,
        kindLabel: raw.kindLabel,
        sourceName: raw.sourceName,
        sourceUrl: raw.sourceUrl,
        observedAt: raw.observedAt,
        quote: source.evidenceText,
      });
    } catch {
      // 落不回原文的引用不算真实原话，但也不让整条问题读不出来——降档就是它的处理方式。
    }
  }
  if (!quotes.length) {
    return {
      grade: EVIDENCE_GRADES.RECORDED,
      label: EVIDENCE_LABELS.recorded,
      quotes: [],
      verbatimCount: 0,
      note: "人工记录，没有可回溯的原始原话。",
    };
  }
  return {
    grade: EVIDENCE_GRADES.VERBATIM,
    label: EVIDENCE_LABELS.verbatim,
    quotes,
    verbatimCount: quotes.length,
    note: `${quotes.length} 段可逐字回溯的真实原话。`,
  };
}

export class AudienceRawDomain {
  constructor({ db, repository, workspaceDomain }) {
    this.db = db;
    this.repository = repository;
    this.workspaceDomain = workspaceDomain;
  }

  /**
   * 记下一段原话。
   *
   * ⚠️ **同一段正文重复粘贴不再写一条。** 用户在意的是「这段话被记住了」，
   * 而不是「记了几次」；两条一模一样的证据只会让后面所有计数和去重都变难。
   * 返回 `duplicate: true` 和原来那条，由界面照实说「这段之前已经记过」。
   */
  record({ id = createUlid(), kind = "other", body, sourceName = "", sourceUrl = "", observedAt = "", actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "记录用户声音");
    const canonicalKind = clean(kind) || "other";
    if (!KIND_SET.has(canonicalKind)) throw new TypeError("用户声音来源种类不受支持");
    const text = normalizeRawBody(body);
    if (!text) throw new TypeError("原话不能为空");
    if (text.length > 200_000) throw new TypeError("单次粘贴的原话不能超过 200000 字");
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const existing = this.db.prepare(`${SELECT} WHERE r.content_sha256 = ? ORDER BY r.ingested_at LIMIT 1`).get(hash);
    if (existing) return { id: existing.id, duplicate: true, source: rawDto(existing) };

    const stamp = isoNow(now);
    const record = {
      kind: canonicalKind,
      sourceName: optional(sourceName, "来源名称", 200),
      sourceUrl: optional(sourceUrl, "来源链接", 2000),
      // 用户没说这话是什么时候说的，就记成导入时间，不去猜。
      observedAt: observedAt ? isoNow(observedAt) : stamp,
    };
    this.repository.transaction(() => {
      this.repository.createEntity({ id, type: "audience_raw_source", now });
      this.db.prepare(`INSERT INTO audience_raw_sources(
        id,kind,body,content_sha256,source_name,source_url,observed_at,ingested_at,analyzed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
        .run(id, record.kind, text, hash, record.sourceName, record.sourceUrl, record.observedAt, stamp);
      // 标题只是给全局检索用的一句提要，不是用户要填的字段。
      this.repository.setEntityText(id, {
        title: `${audienceRawKindLabel(record.kind)}：${record.sourceName || text.slice(0, 40)}`.slice(0, 200),
        body: text,
        now,
      });
      this.workspaceDomain.audit("audience_raw_source.recorded", id, {
        kind: record.kind,
        length: text.length,
        hasSourceUrl: Boolean(record.sourceUrl),
      }, now);
    });
    return { id, duplicate: false, source: this.source(id) };
  }

  source(id) {
    const row = this.db.prepare(`${SELECT} WHERE r.id = ?`).get(clean(id));
    if (!row) throw Object.assign(new Error("原始用户声音不存在"), { status: 404 });
    return rawDto(row);
  }

  /**
   * 列出原话。`pendingOnly` 只给还没被分析过的那些——
   * Discovery 的上下文预算靠它，不是靠每次把全部历史群聊重新发一遍。
   */
  sources({ limit = 20, pendingOnly = false } = {}) {
    const size = Math.max(1, Math.min(200, Number(limit) || 20));
    return this.db.prepare(`${SELECT} ${pendingOnly ? "WHERE r.analyzed_at IS NULL" : ""}
      ORDER BY r.ingested_at DESC, r.id DESC LIMIT ?`).all(size).map(rawDto);
  }

  /** 有多少条原话引用了它——界面用来说「这段原话支撑了 N 条用户问题」。 */
  citationCount(id) {
    return this.db.prepare("SELECT COUNT(*) AS count FROM audience_problem_sources WHERE source_id = ?")
      .get(rawSourceRef(id)).count;
  }

  markAnalyzed(ids, { now } = {}) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(clean).filter(Boolean))];
    if (!list.length) return 0;
    const stamp = isoNow(now);
    const update = this.db.prepare("UPDATE audience_raw_sources SET analyzed_at = ? WHERE id = ?");
    return this.repository.transaction(() => list.reduce((count, id) => count + update.run(stamp, id).changes, 0));
  }

  /**
   * 缓存指纹用的统计。
   *
   * ⚠️ **必须包含 `total`，不能只看最新时间。** 只看 max(ingested_at) 的话，
   * 同一秒内粘进来的第二段会被当成「没有变化」，而那正是用户连着粘几段的常见节奏。
   */
  stats() {
    const row = this.db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN r.analyzed_at IS NULL THEN 1 ELSE 0 END) AS pending,
        MAX(r.ingested_at) AS latest
      FROM audience_raw_sources r JOIN entities e ON e.id = r.id AND e.deleted_at IS NULL`).get();
    return { total: row.total || 0, pending: row.pending || 0, latest: row.latest || "" };
  }
}
