/**
 * 内容首页：最近有什么值得讲。
 *
 * ⚠️ **这一页不是两栏选择器。** 上一版打开「内容机会」，第一件事是左边选 Wiki、
 * 右边选用户问题——那是在操作数据库，而且它默认你已经知道该连哪两个。
 * 真实的顺序是反过来的：先让系统读一遍我的知识和现实里听到的话，
 * 把值得判断的少数几件事摆出来，我再决定。
 *
 * ⚠️ **没有一排筛选器。** 第一屏只回答一个问题：Xenho 最近发现了什么值得我判断？
 * 手动挑两个东西连起来仍然可以，但那是逃生口，不是主路径。
 *
 * ⚠️ **不自动跑模型。** 打开页面显示的是上次的结果和它的时间；
 * 数据真的变了才提示可以重新扫描。每进一次页面烧一次模型，既贵又让人不敢进来。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, Note, relTime } from "../components/ui.jsx";
import { setDiscoveryHandoff, takeDiscoveryFocus } from "../lib/discovery-handoff.js";
import { IconSparkles, IconArrowRight, IconMessageQuestion, IconRefresh } from "../components/icons.jsx";
import "./content-bridge.css";
import "./content-discovery.css";

const FIT_LABELS = { strong: "很自然", medium: "值得继续", weak: "比较牵强" };

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

/**
 * 一条连接候选。
 *
 * 排版顺序就是判断顺序：**谁在困惑什么 → 用我的什么知识 → 为什么值得连 →
 * 可能留下什么判断**。分数、热度、爆款概率一个都没有——那些东西看起来像依据，
 * 其实什么都没解释。
 */
function ConnectionCard({ connection, onDevelop, busy }) {
  const [quotesOpen, setQuotesOpen] = useState(false);
  const [more, setMore] = useState(false);
  const hypothesis = connection.problem.origin === "hypothesis";
  const quotes = connection.problem.evidence || [];

  return (
    <article className="discovery-card" data-fit={connection.fit}>
      <header className="discovery-card__problem">
        <span className="discovery-card__label">{hypothesis ? "你认为可能有人在困惑" : "有人在问"}</span>
        <h3>{connection.problem.statement}</h3>
        {/*
          ⚠️ **证据说明只有一处真源**，措辞由服务端给。
          「N 段真实原话」和「尚待验证」差一个字都不行：把手工记录或议程推导
          显示成真实反馈，是这套系统里最容易犯、也最难发现的那种假。
        */}
        <p className="discovery-evidence" data-origin={connection.problem.origin}>
          {connection.problem.evidenceLabel}
          {quotes.length ? (
            <button type="button" aria-expanded={quotesOpen} onClick={() => setQuotesOpen((value) => !value)}>
              {quotesOpen ? "收起原话" : "看原话"}
            </button>
          ) : null}
        </p>
        {quotesOpen && quotes.length ? (
          <ul className="discovery-quotes">
            {quotes.map((item, index) => (
              <li key={`${item.rawSourceId}:${index}`}>
                <q>{item.quote}</q>
                <small>{item.kindLabel}{item.sourceName ? ` · ${item.sourceName}` : ""}{item.observedAt ? ` · ${dateLabel(item.observedAt)}` : ""}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="discovery-card__anchors">
        <span className="discovery-card__label">你的知识</span>
        <ul>
          {connection.knowledgeAnchors.map((anchor) => (
            <li key={anchor.wikiPageId}>
              <strong>{anchor.title}</strong>
              {anchor.reason ? <span>{anchor.reason}</span> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="discovery-card__why">
        <span className="discovery-card__label">为什么值得连接</span>
        <p>{connection.fitReason}</p>
      </div>

      <div className="discovery-card__claim">
        <span className="discovery-card__label">可能留下的判断</span>
        <p>{connection.coreClaim}</p>
      </div>

      {/*
        ⚠️ **完整解释、证据缺口和议程说明默认折起来。**
        这一屏要回答的是「值不值得我判断」，那只需要：谁在困惑、用我的什么、
        为什么值得连、可能留下什么判断。其余的是**决定发展之后**才要读的东西，
        默认铺开只会让三张卡各自变成一屏。
      */}
      {more ? (
        <div className="discovery-card__more">
          <div>
            <span className="discovery-card__label">这条知识怎么解释它</span>
            <p>{connection.knowledgeExplanation}</p>
          </div>
          <div>
            <span className="discovery-card__label">大众现在卡在哪</span>
            <p>{connection.cognitiveGap}</p>
          </div>
          {connection.evidenceGaps?.length ? (
            <div>
              <span className="discovery-card__label">现在还缺</span>
              <ul>{connection.evidenceGaps.map((gap, index) => <li key={`${gap}:${index}`}>{gap}</li>)}</ul>
            </div>
          ) : null}
          {connection.agendaSuggestion?.reason ? (
            <div>
              <span className="discovery-card__label">和长期议程的关系</span>
              <p>{connection.agendaSuggestion.reason}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="discovery-card__foot">
        <span className="bridge-fit" data-fit={connection.fit}>{FIT_LABELS[connection.fit] || connection.fit}</span>
        <button type="button" className="discovery-card__more-toggle" aria-expanded={more} onClick={() => setMore((value) => !value)}>
          {more ? "收起" : "看完整解释"}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDevelop(connection)}>
          发展这条
          <IconArrowRight aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

export function ContentDiscovery({ onGo, onCaptureVoice }) {
  const [data, setData] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [error, setError] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  /** 复盘学到的东西带过来的「这次优先看哪儿」。取完即清：它只影响这一次扫描。 */
  const [focus] = useState(() => takeDiscoveryFocus());

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.contentDiscovery(),
      api.contentOpportunities().catch(() => ({ opportunities: [] })),
    ])
      .then(([discovery, saved]) => {
        setData(discovery);
        setOpportunities(saved.opportunities || []);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const scan = useCallback(async ({ force = false } = {}) => {
    setScanning(true);
    setScanError(null);
    try {
      const result = await api.scanContentDiscovery({ force, focus: focus || undefined });
      setData((current) => ({ ...(current || {}), ...result }));
    } catch (failure) {
      /**
       * ⚠️ **模型失败不清空上次的结果。** 这一页的价值在那几条连接上，
       * 因为一次调用超时就把它们抹掉，是把用户的损失放大了一倍。
       */
      setScanError(failure);
    } finally {
      setScanning(false);
    }
  }, [focus]);

  const develop = useCallback((connection) => {
    // ⚠️ 这里**什么都不写库**。候选一路带到「保存为内容机会」那一刻。
    setDiscoveryHandoff(connection);
    onGo("bridge", "develop");
  }, [onGo]);

  const scan_ = data?.scan || null;
  const connections = scan_?.connections || [];
  const read = scan_?.read || null;
  const stale = Boolean(data?.stale);
  const neverScanned = !scan_;

  const summary = useMemo(() => {
    if (!read) return "";
    const parts = [`${read.wikiPages} 条知识`];
    if (read.voices) parts.push(`${read.voices} 段原话`);
    if (read.problems) parts.push(`${read.problems} 条已确认问题`);
    return parts.join(" · ");
  }, [read]);

  return (
    <div className="view-body content-bridge content-discovery">
      <div className="bridge-bar">
        <div className="bridge-bar__title">
          <h2>最近有什么值得讲</h2>
          {scan_ ? <small>{relTime(scan_.scannedAt)}扫描{summary ? ` · 读了 ${summary}` : ""}</small> : null}
        </div>
        <div className="bridge-bar__actions">
          <button type="button" className="btn btn-sm" onClick={() => onCaptureVoice?.("")}>
            <IconMessageQuestion aria-hidden="true" stroke={1.7} />
            记录用户声音
          </button>
          <button type="button" className="btn btn-sm" onClick={() => onGo("bridge", "manual")}>手动探索</button>
          {scan_ ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={scanning} onClick={() => scan({ force: true })}>
              <IconRefresh aria-hidden="true" className={scanning ? "spinning" : ""} />
              {scanning ? "正在扫描…" : "重新扫描"}
            </button>
          ) : null}
        </div>
      </div>

      <ErrorNote error={error} what="读取内容发现" onRetry={load} />
      {loading && !data ? <Loading rows={3} /> : null}

      {/*
        ⚠️ 带着复盘学到的东西过来时要说出来。
        不说的话，用户会奇怪这次扫描的结果为什么偏向某个方向。
      */}
      {focus && !scanning ? (
        <div className="discovery-stale" role="status">
          <span>这次会按你上一篇复盘学到的东西优先看：{focus}</span>
        </div>
      ) : null}

      {/* 数据变了才提示。⚠️ 说清**变了什么**：「又记了 2 段原话」比「有更新」多回答一个问题。 */}
      {data && stale && scan_ && !scanning ? (
        <div className="discovery-stale" role="status">
          <span>{data.staleReason}。要不要重新看一遍？</span>
          <button type="button" className="btn btn-sm" onClick={() => scan({ force: true })}>重新扫描</button>
        </div>
      ) : null}

      {scanError ? (
        <div className="discovery-failed">
          <ErrorNote error={scanError} what="这次扫描" onRetry={() => scan({ force: true })} />
          <p>
            {connections.length
              ? "下面还是上一次的结果，你的知识、原话和已有内容机会都没有被改动。"
              : "你的知识、原话和已有内容机会都没有被改动。也可以先手动探索。"}
            <button type="button" className="btn btn-sm" onClick={() => onGo("bridge", "manual")}>手动探索</button>
          </p>
        </div>
      ) : null}

      {scanning ? (
        <div className="bridge-pending" aria-live="polite">
          <p>正在读你的知识和最近听到的原话…</p>
          <small>通常十几秒。找出来的是候选，你判断之后才会继续。</small>
        </div>
      ) : null}

      {data && neverScanned && !scanning ? (
        <div className="bridge-blank">
          <h3>先看看最近有什么值得讲</h3>
          <p>
            不用先挑知识，也不用先整理用户问题。Xenho 会读一遍你的知识和最近记下的原话，
            找出几条值得你判断的连接。
          </p>
          <button type="button" className="btn btn-primary" onClick={() => scan({ force: true })}>
            <IconSparkles aria-hidden="true" />
            帮我看看最近有什么值得讲
          </button>
        </div>
      ) : null}

      {scan_ && !scanning && connections.length ? (
        <section className="discovery-list" aria-label="值得发展的连接">
          {connections.map((connection, index) => (
            <ConnectionCard
              key={`${connection.problem.statement}:${index}`}
              connection={connection}
              busy={scanning}
              onDevelop={develop}
            />
          ))}
        </section>
      ) : null}

      {/*
        ⚠️ **允许说「最近没有值得做的」，并且必须说清下一步。**
        为了让页面看起来智能而硬生成几条选题，比空着更糟：它会消耗掉用户
        对这一页的信任，而信任是这一页唯一的资产。
      */}
      {scan_ && !scanning && !connections.length ? (
        <div className="discovery-empty">
          <h3>最近没有发现足够自然的新连接</h3>
          <p>{scan_.nothingFoundReason}</p>
          <div className="discovery-empty__outs">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onCaptureVoice?.("")}>
              导入一些真实用户声音
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onGo("bridge", "manual")}>
              自己挑两个东西连连看
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onGo("entries")}>
              先去继续研究知识
            </button>
          </div>
        </div>
      ) : null}

      {opportunities.length ? (
        <section className="discovery-saved" aria-label="进行中的内容机会">
          <h3 className="section-label">进行中</h3>
          <ul className="bridge-opp-list">
            {opportunities.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => onGo("bridge", `opportunity:${item.id}`)} aria-label={`打开内容机会：${item.wikiTitle} × ${item.audienceProblemStatement}`}>
                  <span className="bridge-opp-pair">
                    <strong>{item.wikiTitle || "已删除的知识"}</strong>
                    <em aria-hidden="true">×</em>
                    <strong>{item.audienceProblemStatement}</strong>
                  </span>
                  <span className="bridge-opp-claim">{item.coreClaim}</span>
                  <span className="bridge-opp-meta">
                    <span className="bridge-fit" data-fit={item.fit}>{FIT_LABELS[item.fit] || item.fit}</span>
                    <em>{item.hasProject ? "已建立项目" : "待建立项目"}</em>
                    <small>{dateLabel(item.updatedAt)}更新</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {scan_ && !connections.length && !scan_.nothingFoundReason ? (
        <Note title="这次没有读到任何东西">扫描没有出错，但工作台里暂时没有可用的知识或真实声音。</Note>
      ) : null}
    </div>
  );
}
