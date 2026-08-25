// 选种：**我现在想写，但还没有种子**。
//
// ⚠️ **这一页不产出选题，它产出候选。**
// 使用者问过「是不是应该一键获取选题」——不应该。他自己贴的参考里第一句就是
//「不存在一键找选题这个事情」，而更硬的理由是：**一键产出的选题不带你的判断**，
// 那正是他两个卡点里的第二个（「不知道自己能加什么」）。
// 所以每条候选变成种子时**仍然要你补一句 take**（走 `ReactionPicker`）。
//
// ⚠️ **一个列表 + 一行来源，不是三段并列。**
// 三段那一版里，洞察那 8 张卡把另外两个入口挤到了屏外——你得滚很久才看得到
// 「从素材里找」和「拆争点」。现在三个来源站在同一排。
//
// 三段各对应一条已有但接不上出口的输入：
//   洞察     ← 每周跑批的 candidate-registry.json，原来躺在 tmp/ 里进不了任何地方
//   素材     ← 你自己攒的存量，原来只有每日自动整理，没法按时间范围手动聚
//   争点     ← 热点，原来只能「有反应」，而你还没反应的时候答不上来

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { FilterHeader, ErrorNote, Loading, Empty } from "../components/ui.jsx";
import { IdeaCard } from "../components/IdeaCard.jsx";
import { ReactionPicker } from "../components/ReactionPicker.jsx";
import { IconBulb, IconSearch } from "../components/icons.jsx";

/** 本地日期。⚠️ 不用 `toISOString()`——东八区晚上会落进明天，和计划那条同一个坑。 */
const localDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 跑批给的队列状态翻成人话。⚠️ 只是**显示**，不据此过滤。 */
const STATUS_LABEL = {
  ready: { label: "能写了", tone: "done" },
  needs_research: { label: "还要查资料", tone: "doing" },
  watch: { label: "先看着", tone: "backlog" },
  weak_signal: { label: "信号还弱", tone: "backlog" },
};

export function Ideas({ onGo, onChanged }) {
  const [from, setFrom] = useState("insight");
  const [seeding, setSeeding] = useState(null);
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [insight, setInsight] = useState(null);
  const [insightError, setInsightError] = useState(null);

  const [range, setRange] = useState({ from: localDay(-14), to: localDay(0) });
  const [mat, setMat] = useState({ cards: [], busy: false, error: null, ran: false, scanned: 0 });

  const [hot, setHot] = useState(null);
  const [picked, setPicked] = useState("");
  const [angles, setAngles] = useState({ cards: [], busy: false, error: null, ran: false });

  useEffect(() => {
    // ⚠️ 反应清单的真源在 Worker（`GET /wb/seeds` 的 reactionGroups），前端一个字都不写死
    api.seeds().then((d) => setGroups(d.reactionGroups || [])).catch(() => {});
    api.ideaCandidates().then(setInsight).catch(setInsightError);
    // 热点取一次，用来挑一条拆争点。**取不到不挡这一页另外两个来源**
    api.hotAi({}).then(setHot).catch(() => setHot({ items: [] }));
  }, []);

  const save = useCallback(async ({ reaction, take }) => {
    setBusy(true);
    setSaveError("");
    try {
      await api.createSeed({ take, reaction, ...seeding.seed });
      setSeeding(null);
      onChanged?.();
      // 记完就去种子池：那一页回答的是「今天写哪个」，这一页的活到此为止
      onGo("seeds");
    } catch (e) {
      setSaveError(e.message || "记不下来");
    } finally {
      setBusy(false);
    }
  }, [seeding, onChanged, onGo]);

  function runMaterials() {
    if (mat.busy) return;
    setMat((p) => ({ ...p, busy: true, error: null }));
    api.ideaMaterials(range)
      .then((r) => setMat({ cards: r.cards || [], busy: false, error: null, ran: true, scanned: r.scanned || 0 }))
      .catch((e) => setMat((p) => ({ ...p, busy: false, error: e, ran: true })));
  }

  function runAngles() {
    const item = (hot?.items || []).find((x) => x.link === picked);
    if (!item || angles.busy) return;
    setAngles({ cards: [], busy: true, error: null, ran: false });
    api.ideaAngles({ title: item.title, summary: item.summary || "", url: item.link || "" })
      .then((r) => setAngles({ cards: r.cards || [], busy: false, error: null, ran: true }))
      .catch((e) => setAngles({ cards: [], busy: false, error: e, ran: true }));
  }

  const hotItem = (hot?.items || []).find((x) => x.link === picked);

  /**
   * ⚠️ **`take` 预填成这条卡的角度。**
   * 使用者说「暂时没想法但觉得可以写，应该可以直接记」——而这张卡的角度
   * **本身就是一句判断**，直接当 take 用，你可以改也可以直接按「记下来」。
   * **规则一个字没松**（种子仍然必须有一句话），只是不用你从零打字。
   *
   * ⚠️ 整张卡写进 `source_excerpt`：项目页右栏靠它显示「这一篇是从哪儿来的」。
   */
  const openSeed = async (card, seed) => {
    setSaveError("");
    if (!groups.length) {
      try {
        const data = await api.seeds();
        const nextGroups = data.reactionGroups || [];
        if (!nextGroups.length) throw new Error("反应清单暂时不可用");
        setGroups(nextGroups);
      } catch (error) {
        setSaveError(error.message || "反应清单暂时不可用，请重试");
      }
    }
    setSeeding({
      title: card.angle,
      take: card.angle,
      seed: { ...seed, sourceExcerpt: cardAsText(card), sourceFetchedAt: Math.floor(Date.now() / 1000) },
    });
  };

  const chips = [
    { key: "insight", label: "洞察", count: insight?.items?.length ?? null },
    { key: "material", label: "素材", count: mat.ran ? mat.cards.length : null },
    { key: "angle", label: "争点", count: angles.ran ? angles.cards.length : null },
  ];

  return (
    <>
      {/**
        * ⚠️ **三个来源站在同一排，而且排在最上面。**
        * 上一版三段并列，洞察那 8 张卡把另外两个入口挤到了屏外——
        * 而那两个恰恰是「我主动想找点什么写」时最该按的。
        */}
      <FilterHeader
        title="找题"
        desc="还没确定写什么时从这儿开始。选题顾问会从洞察、素材和争点里整理候选；你挑一条并留下自己的判断。"
        chips={
          <div className="chips chips-sm" aria-label="候选从哪来">
            {chips.map((c) => (
              <button key={c.key} className="chip" aria-pressed={from === c.key} onClick={() => setFrom(c.key)}>
                {c.label}{c.count == null ? "" : ` ${c.count}`}
              </button>
            ))}
          </div>
        }
      />

      {from === "insight" ? (
        <section className="ideas__sec">
          <p className="page-sub">
            {insight?.week ? `${insight.week} 那次跑批留下的候选` : "每周跑批产出的候选"}
            {/* ⚠️ 出卡失败时照实说：那批候选**本身仍然有用**，只是少了几项 */}
            {insight && insight.cards === false && insight.items?.length
              ? "。这批还没写成完整的卡（" + (insight.why || "出卡没跑通") + "）"
              : ""}
          </p>
          <ErrorNote error={insightError} what="读取洞察候选" />
          {/**
            * ⚠️ **第一次打开这一周的候选要等一次出卡（一次 LLM）。**
            * 只给骨架的话，你看到的是「一片灰条」——分不出是在加载、还是这周没东西。
            * 出完卡会缓存进 `tmp/insight-work/<week>/idea-cards.json`，
            * 所以这一句一周只出现一次。
            */}
          {!insight && !insightError ? (
            <>
              <p className="ideas__note">正在为这一周的候选写卡片……这一步要跑一次模型，一周只跑这一次。</p>
              <Loading rows={3} />
            </>
          ) : null}
          {insight && !insight.items.length ? (
            <Empty icon={IconBulb}>
              还没有跑过洞察，或者那一次没留下候选。去
              <button className="link-btn" onClick={() => onGo("insights")}>洞察</button>
              那一页跑一次。
            </Empty>
          ) : null}
          <div className="ideas__list">
            {(insight?.items || []).map((c) => {
              const st = STATUS_LABEL[c.status];
              const card = c.card || { angle: c.title, materials: [] };
              return (
                <IdeaCard
                  key={c.id || c.title}
                  card={card}
                  source={`洞察 ${insight.week}`}
                  busy={busy}
                  tags={[
                    /**
                     * ⚠️ **不按状态过滤。** 「还要查资料」的那些也可能正是你想写的——
                     * 状态照实标出来让你自己判断。**偷偷过滤的界面看不出自己在过滤。**
                     */
                    st ? { label: st.label, tone: st.tone } : null,
                    c.score ? { label: `${c.score} 分` } : null,
                  ].filter(Boolean)}
                  /**
                   * ⚠️ **来源里不要再抄一遍那条角度。**
                   * 上面那句 take 就是它——写进 `sourceTitle` 的话，
                   * 右栏会把同一句话印两遍，而第二遍还因为太长被截断。
                   * 来源只说「从哪来」：哪一周的跑批。
                   */
                  onSeed={() => openSeed(card, { sourceKind: "none", sourceTitle: `洞察 ${insight.week}` })}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {from === "material" ? (
        <section className="ideas__sec">
          <p className="page-sub">选一段时间，看看你攒的这些合起来能说什么。一个角度至少要连上两条素材——单条你自己翻的时候就看见了。</p>
          <div className="ideas__run">
            <label>从<input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
            <label>到<input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
            <button className="btn btn-sm" onClick={runMaterials} disabled={mat.busy}>
              <IconSearch size={13} stroke={1.8} aria-hidden="true" />{mat.busy ? "正在读这段时间的素材…" : "找找看"}
            </button>
          </div>
          <ErrorNote error={mat.error} what="聚合素材" />
          {/* 找不出来是**正常结果**：一个角度至少要连上两条素材才算数，凑不出就照实说 */}
          {mat.ran && !mat.busy && !mat.error && !mat.cards.length ? (
            <p className="ideas__note">读了这段时间的 {mat.scanned} 条素材，没找出能连起来的角度。换一段更长的时间试试。</p>
          ) : null}
          <div className="ideas__list">
            {mat.cards.map((card) => (
              <IdeaCard
                key={card.angle}
                card={card}
                source="从素材聚出来"
                busy={busy}
                onSeed={() => openSeed(card, { sourceKind: "material", sourceTitle: `从 ${range.from} 到 ${range.to} 的素材里聚出来` })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {from === "angle" ? (
        <section className="ideas__sec">
          {/**
            * ⚠️ **这和反应清单不是一件事。**
            * 反应清单问「你什么反应」——那个问题在你还没找到抓手的时候是答不上来的。
            * 争点问「这件事的分歧在哪」，是**在你还没有反应的时候，帮你找到可以有反应的地方**。
            */}
          <p className="page-sub">看清谁和谁在为什么吵，你站哪边、有什么例子，当场就有了。</p>
          <div className="ideas__run">
            <select
              className="ideas__pick"
              aria-label="挑一条最近的事"
              value={picked}
              onChange={(e) => { setPicked(e.target.value); setAngles({ cards: [], busy: false, error: null, ran: false }); }}
            >
              <option value="">挑一条最近的事…</option>
              {(hot?.items || []).slice(0, 20).map((it) => (
                <option key={it.link || it.title} value={it.link}>{it.title}</option>
              ))}
            </select>
            <button className="btn btn-sm" onClick={runAngles} disabled={!hotItem || angles.busy}>
              <IconSearch size={13} stroke={1.8} aria-hidden="true" />{angles.busy ? "正在拆…" : "拆争点"}
            </button>
          </div>
          {!hot ? <Loading rows={1} /> : null}
          {hot && !hot.items?.length ? (
            <p className="ideas__note">
              这会儿没抓到 AI 情报，去
              <button className="link-btn" onClick={() => onGo("hot")}>热点</button>
              那一页刷新一下。
            </p>
          ) : null}
          <ErrorNote error={angles.error} what="拆争点" />
          {angles.ran && !angles.busy && !angles.error && !angles.cards.length ? (
            <p className="ideas__note">这条里没找出真的分歧——硬凑一个争点会让你对着不存在的矛盾写半天。换一条试试。</p>
          ) : null}
          <div className="ideas__list">
            {angles.cards.map((card) => (
              <IdeaCard
                key={card.angle}
                card={card}
                source={hotItem?.title || "热点"}
                busy={busy}
                onSeed={() => openSeed(card, { sourceKind: "hot", sourceTitle: hotItem?.title || "", sourceUrl: hotItem?.link || "" })}
              />
            ))}
          </div>
        </section>
      ) : null}

      <ReactionPicker
        open={!!seeding}
        groups={groups}
        source={seeding ? { title: seeding.title, url: seeding.seed.sourceUrl || "" } : null}
        prefill={seeding?.take || ""}
        busy={busy}
        error={saveError}
        onClose={() => setSeeding(null)}
        onSave={save}
      />
    </>
  );
}

/**
 * 整张卡压成一段可读文本，存进 `seeds.source_excerpt`。
 *
 * ⚠️ **存文本而不是 JSON**：项目页右栏那一栏是拿来**读**的（`renderMarkdown`），
 * 而且这一列本来就是给「来源正文」用的——两种来源存成同一个形状，
 * 右栏就不用分情况处理。
 */
function cardAsText(card) {
  const lines = [];
  if (card.audience) lines.push(`**给谁看**：${card.audience}`);
  if (card.pain) lines.push(`**他卡在哪**：${card.pain}`);
  if (card.why) lines.push(`**为什么值得你写**：${card.why}`);
  if (card.materials?.length) {
    lines.push("**能用的素材**：");
    for (const m of card.materials) lines.push(`- ${m.title}${m.use ? ` —— ${m.use}` : ""}`);
  }
  const spec = [card.form, card.effort].filter(Boolean).join(" · ");
  if (spec) lines.push(`**写成什么**：${spec}`);
  return lines.join("\n\n");
}
