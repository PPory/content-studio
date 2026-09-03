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
 * 一条连接候选。**一行，不是一整块。**
 *
 * ⚠️ **别再让它铺成一大段散文。** 一次扫描默认给 4 条、最多 5 条
 *（`content-discovery-ai.mjs` 的 `DEFAULT_LIMIT` / `MAX_LIMIT`），
 * 而上一版每条是一块 268px 的满宽长文——四条叠起来一屏多，
 * **你没法把它们放在一起比**，只能一条条读下去，读到第四条时第一条已经忘了。
 * 这一步是**在几条里挑一条**，那就得像清单一样能横着扫。
 *
 * 折叠时只留能做选择的三样，其余全部收起：
 *   1. **判断**——真发展下去要写的就是这句话，也是几条之间差别最大的地方，所以它是标题；
 *   2. **问句 + 证据成色**——这事是不是真有人在困惑；
 *   3. **凭哪几条知识**——是不是我能说的。
 * 理由（为什么值得连、知识怎么解释、大众卡在哪）是**决定倾向某一条之后**才读的，
 * 展开才给。
 *
 * ⚠️ **不做「卡片 / 列表」切换。** 四条以内的东西给两种看法，是把一个本来
 * 有答案的问题丢回给用户；而这一页的答案很明确：**要比较，所以是列表。**
 */
function ConnectionCard({ connection, onDevelop, busy }) {
  const [quotesOpen, setQuotesOpen] = useState(false);
  const [more, setMore] = useState(false);
  const quotes = connection.problem.evidence || [];
  const anchors = connection.knowledgeAnchors || [];

  return (
    <article className="discovery-card" data-fit={connection.fit} data-open={more ? "" : undefined}>
      <div className="discovery-card__row">
        {/* 评级在最左边：一列扫下来，「很自然」和「比较牵强」的分布一眼看得出 */}
        <span className="discovery-card__fit" data-fit={connection.fit}>
          {FIT_LABELS[connection.fit] || connection.fit}
        </span>

        <div className="discovery-card__body">
          {/* 判断是这一条的产物，也是几条之间差别最大的地方，所以它当标题 */}
          <h3 className="discovery-card__claim">{connection.coreClaim}</h3>

          {/* 问句和证据成色各占一行：一个是「他们问什么」，一个是「这话有多硬」，
              硬挤在一行时中间那个分隔点会被换行甩到句尾，孤零零挂着 */}
          <p className="discovery-card__q">{connection.problem.statement}</p>
          <p className="discovery-card__from" data-origin={connection.problem.origin}>
            {/**
              * ⚠️ **只用 `evidenceLabel`，别在前面再加一句自己的话。**
              * 服务端那句已经把话说完了，而且 `content-discovery-ai.mjs` 明写着
              * 「真实性文案只有一处真源」。上一版在它前面还加了「你推测有人在困惑」，
              * 屏幕上就成了同一个免责声明连说两遍。
              */}
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
        </div>

        {/**
          * ⚠️ **锚点是自己一列，不挤在正文里。**
          * 四条候选并排时，「我这几条都在动用哪些知识」是横着扫才看得出来的事
          *（这一屏三条都压在《写作障碍》上）；混在正文段落里就只能一条条读。
          * 和素材页那张表把元信息拉成右侧几列是同一条：**能对齐成列的东西就别塞进正文。**
          */}
        <p className="discovery-card__anchors">
          {anchors.map((anchor) => (
            <span key={anchor.wikiPageId} className="discovery-anchor">{anchor.title}</span>
          ))}
        </p>

        <div className="discovery-card__acts">
          <button type="button" className="discovery-card__more-toggle" aria-expanded={more} onClick={() => setMore((value) => !value)}>
            {more ? "收起" : "看完整解释"}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDevelop(connection)}>
            发展这条
            <IconArrowRight aria-hidden="true" />
          </button>
        </div>
      </div>

      {/*
        ⚠️ **理由默认全部收起。**
        折叠那一行要回答的是「在这几条里挑哪一条」，那只需要判断、问句和凭据。
        为什么值得连、知识怎么解释、大众卡在哪——都是**倾向某一条之后**才读的东西，
        默认铺开会让四条各自变成一屏，而那正是这一版要治的毛病。
      */}
      {more ? (
        <div className="discovery-card__more">
          <div>
            <span className="discovery-card__label">为什么值得连接</span>
            <p>{connection.fitReason}</p>
          </div>
          {anchors.some((anchor) => anchor.reason) ? (
            <div>
              <span className="discovery-card__label">每条知识各解释了什么</span>
              <ul className="discovery-anchor-why">
                {anchors.filter((anchor) => anchor.reason).map((anchor) => (
                  <li key={anchor.wikiPageId}><strong>{anchor.title}</strong><span>{anchor.reason}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
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
  const [focus, setFocus] = useState(() => takeDiscoveryFocus());
  /** 最近在助手里聊过什么。⚠️ 只含你自己打的字：AI 的回答不是事实来源。 */
  const [research, setResearch] = useState([]);
  const [researchOpen, setResearchOpen] = useState(false);
  /**
   * 长期议程：现在够不够看出一条。
   * ⚠️ 不够就说还差多少，并且**不跑模型**——那种情况下它只会把现有几条重新包装一遍。
   */
  const [agendaSignals, setAgendaSignals] = useState(null);
  const [agendaCandidates, setAgendaCandidates] = useState(null);
  const [agendaBusy, setAgendaBusy] = useState(false);
  const [agendaKept, setAgendaKept] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.contentDiscovery(),
      api.contentOpportunities().catch(() => ({ opportunities: [] })),
      api.researchSignals().catch(() => ({ signals: [] })),
      api.agendaSignals().catch(() => null),
    ])
      .then(([discovery, saved, signals, agenda]) => {
        setData(discovery);
        setOpportunities(saved.opportunities || []);
        setResearch(signals.signals || []);
        setAgendaSignals(agenda);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const scan = useCallback(async ({ force = false, focusOverride } = {}) => {
    setScanning(true);
    setScanError(null);
    try {
      const result = await api.scanContentDiscovery({ force, focus: focusOverride || focus || undefined });
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
          {/**
            * ⚠️ **「有更新」并进这一行，不再单独一条横带。**
            * 上一版页头有一颗黑色的「重新扫描」，正下方 60px 又是一条
            * 「知识、用户问题或议程有更新。要不要重新看一遍？[重新扫描]」——
            * **同一个动作，两颗按钮，隔着一行**。
            * 提示里真正多说的那件事是**变了什么**，那属于这行说明；
            * 按钮只需要一颗，而且永远在同一个位置。
            */}
          {scan_ ? (
            <small>
              {relTime(scan_.scannedAt)}扫描{summary ? ` · 读了 ${summary}` : ""}
              {stale && data?.staleReason ? <b className="bridge-bar__stale">{data.staleReason}</b> : null}
            </small>
          ) : null}
        </div>
        <div className="bridge-bar__actions">
          <button type="button" className="btn btn-sm" onClick={() => onCaptureVoice?.("")}>
            <IconMessageQuestion aria-hidden="true" stroke={1.7} />
            真实用户声音
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
          {/* 表头解释那三列各是什么——「凭」单看两个字读不出是知识锚点 */}
          <div className="discovery-list__head" aria-hidden="true">
            <span>贴合</span>
            <span>值得讲的判断</span>
            <span>凭哪几条知识</span>
            <span />
          </div>
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
            {/*
              ⚠️ 这个出口落在搜索那一侧，不是粘贴。
              走到这里说明工作台里的原话不够用了——此时让人「去粘一段」，
              等于要求他先自己找到材料，而那正是这一步该替他做的事。
            */}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onCaptureVoice?.("", "find")}>
              去找找有没有人在说
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

      {/*
        ⚠️ **把「系统看到的研究方向」摆出来，而不是悄悄用掉。**
        这一段是扫描的输入之一；不显示的话，用户会奇怪结果为什么偏向某个方向，
        而且看不出系统到底把什么当成了「他最近在想的」。
        ⚠️ 这里**只有你自己打的字**——AI 的回答不进这一段，也不进扫描的事实层。
      */}
      {research.length ? (
        <section className="discovery-research" aria-label="最近你在想的">
          <button type="button" aria-expanded={researchOpen} onClick={() => setResearchOpen((value) => !value)}>
            最近你在助手里想的 {research.length} 件事{researchOpen ? "" : "（扫描时会参考方向）"}
          </button>
          {researchOpen ? (
            <>
              <p className="discovery-research__gate">
                只取你自己写下的话。AI 的回答不算方向依据，更不算事实——知识仍然要回到 Wiki，证据仍然要回到原话。
              </p>
              <ul>
                {research.map((item) => (
                  <li key={item.conversationId}>
                    <strong>{item.title || "（未命名对话）"}</strong>
                    {/* ⚠️ 标题常常**就是第一句**（会话名取自开场那句），原样铺开时
                        屏幕上是同一句话连着出现两遍。重复的那句去掉再拼。 */}
                    <span>{item.userTurns.filter((turn) => turn !== item.title).join(" / ")}</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={scanning}
                      onClick={async () => {
                        try {
                          const result = await api.conversationFocus(item.conversationId);
                          setFocus(result.focus);
                          await scan({ force: true, focusOverride: result.focus });
                        } catch (failure) { setScanError(failure); }
                      }}
                    >按这段看一遍</button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {/*
        ⚠️ **长期议程是观察出来的，不是填出来的**——和涌现定位同一条规矩。
        数据不够时这一栏说的是「还差多少」，而不是画一个看起来很满的候选：
        三条内容机会看不出「反复」，硬总结出来的那句话只是复述。
      */}
      {agendaSignals ? (
        <section className="discovery-agenda" aria-label="长期议程">
          {agendaSignals.ready ? (
            <>
              <div className="discovery-agenda__head">
                <strong>你最近反复在强化某个判断吗</strong>
                <button type="button" className="btn btn-sm" disabled={agendaBusy} onClick={async () => {
                  setAgendaBusy(true);
                  try {
                    const result = await api.agendaCandidates();
                    setAgendaCandidates(result);
                  } catch (failure) { setScanError(failure); } finally { setAgendaBusy(false); }
                }}>{agendaBusy ? "正在看…" : agendaCandidates ? "再看一遍" : "看看有没有一条长期议程"}</button>
              </div>
              {agendaCandidates && !agendaCandidates.agendas.length ? (
                <p className="discovery-agenda__none">{agendaCandidates.nothingFoundReason}</p>
              ) : null}
              {(agendaCandidates?.agendas || []).map((candidate) => (
                <article key={candidate.title} className="discovery-agenda__card">
                  <strong>{candidate.title}</strong>
                  <p>{candidate.desiredJudgment}</p>
                  <span>{candidate.reason}</span>
                  {/* 依据要摆出来：一条说不出「凭哪几条看出来」的议程，和自己写一句没区别。 */}
                  <small>
                    依据 {candidate.basis.length} 条 · 覆盖 {candidate.problemSpread} 个不同的用户问题
                    <br />{candidate.basis.map((item) => item.label).join("；")}
                  </small>
                  {agendaKept.includes(candidate.title) ? (
                    <em>已设为长期议程</em>
                  ) : (
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={async () => {
                        try {
                          await api.createAgenda({
                            title: candidate.title,
                            desiredJudgment: candidate.desiredJudgment,
                            audience: candidate.audience,
                            problemSpace: candidate.problemSpace,
                            confirmed: true,
                          });
                          setAgendaKept((items) => [...items, candidate.title]);
                        } catch (failure) { setScanError(failure); }
                      }}>设为长期议程</button>
                      <button type="button" className="btn btn-sm" onClick={() => setAgendaCandidates((current) => ({
                        ...current,
                        agendas: current.agendas.filter((item) => item.title !== candidate.title),
                      }))}>暂时不要</button>
                    </div>
                  )}
                </article>
              ))}
            </>
          ) : (
            /* ⚠️ 这条不画彩色左竖线（design-system 明令禁止），也不画引用块：
               它是一句进度说明，不是引文。安静一行，和上面的研究方向同一档。 */
            <p className="discovery-agenda__wait">
              还看不出一条长期议程：{agendaSignals.missing.join("；")}。
              {/* ⚠️ 措辞不要和顶栏那颗「手动探索」重名：一屏两个同名按钮，指的还不是同一件事。 */}
              {" "}要现在就定一条，可以<button type="button" className="linkish" onClick={() => onGo("bridge", "manual")}>自己写一条</button>。
            </p>
          )}
        </section>
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
                  {/**
                    * ⚠️ **这一行不再画贴合度药丸。**
                    * 「很自然」是**保存那一刻**下的判断，摆在这儿不驱动任何动作；
                    * 而这一段回答的是「哪一条我该接着做」——那由「建没建项目」决定。
                    * 上面那张候选卡里同一颗药丸也撤了（它在那儿有 `fitReason` 可以当引子，
                    * 这儿连引子都没有，就只剩一个没有量表的评级）。
                    */}
                  <span className="bridge-opp-meta">
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
