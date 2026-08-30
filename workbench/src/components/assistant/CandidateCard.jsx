/**
 * 正文候选的审阅层。**审阅要读的是「改完之后的文章」，不是「两个版本」。**
 *
 * 这里有三个东西，按候选的大小分工：
 *
 * - `RevisionDecisionBar`：句子 / 选区 / 段落级。正文原位置已经画好了 diff（见
 *   `lib/editor-text-revisions.js`），这条窄栏只负责「多大改动 + 凭什么 + 要不要」。
 * - `RevisionDiff`：把 diff 结果渲染成一段可读的文字，用于专注审阅。
 * - `CandidateCard`：章节 / 全文级，折叠右栏后的专注审阅。
 *
 * ⚠️ **inline 形态不再提供可编辑 textarea。** 上一版给候选配了一个文本框，理由是「万一想
 * 手改一下」。实际用下来，那个框把「读改动」变成了「读一坨新文字」——而手改的需求，采纳
 * 之后在正文里改就是了，正文本来就是编辑器。要退回去的话，退路是在这条栏上加一颗「改一改」，
 * 而不是把框请回来当默认。
 */
import { useEffect, useRef, useState } from "react";
import { changeSummary } from "../../lib/ai/result-model.js";
import { diffTokens } from "../../lib/text-diff.js";
import { IconAlertTriangle, IconArrowBackUp, IconCheck, IconChevronDown, IconMessageCircle, IconRefresh, IconRowInsertBottom, IconSend, IconShieldCheck, IconSparkles } from "../icons.jsx";
import { DraftingMark } from "./loaders.jsx";
import "../text-revision.css";

/** 证据里有没有需要用户看一眼的东西。有的话回执默认展开，而且整条要变色。 */
export function groundingNeedsAttention(grounding) {
  if (!grounding) return false;
  return grounding.gate === "rejected" || grounding.skipped.length > 0 || grounding.unverified.length > 0;
}

export function GroundingReceipt({ grounding, onAction }) {
  if (!grounding) return null;
  return <section className="candidate-grounding" aria-label="证据回执">
    <header><b>证据回执</b><span data-gate={grounding.gate}>{grounding.gate === "rejected" ? "服务端未放行" : "服务端已放行"}</span></header>
    {grounding.used.length ? <div className="candidate-grounding__group"><b>已使用 {grounding.used.length}</b><ul>{grounding.used.map((item) => <li key={item.id}>{item.title}</li>)}</ul></div> : null}
    {grounding.skipped.length ? <div className="candidate-grounding__group is-warning"><b>已跳过 {grounding.skipped.length}</b><ul>{grounding.skipped.map((item) => <li key={item.id}><span><strong>{item.title}</strong><small>{item.reason}</small></span><button type="button" onClick={() => onAction?.(item, item.nextStep)}>{item.nextStep.label}</button></li>)}</ul></div> : null}
    {grounding.unverified.length ? <div className="candidate-grounding__group is-warning"><b>未经核验 {grounding.unverified.length}</b><ul>{grounding.unverified.map((item, index) => <li key={`${item.quote}-${index}`}><span><strong>“{item.quote}”</strong><small>{item.why}</small></span></li>)}</ul></div> : null}
    {grounding.gate === "rejected" && grounding.gateDetail ? <p className="candidate-grounding__gate"><IconAlertTriangle aria-hidden="true" />{grounding.gateDetail}</p> : null}
  </section>;
}

/**
 * 一段带 diff 的正文。删掉的字带删除线，新增的字带底色，没动的字保持原样。
 *
 * `degraded`（超预算退化成整段替换）时不装作逐字比过：分成「原文 / 改成」两块说清楚，
 * 免得用户以为整段每个字都被换了。
 */
export function RevisionDiff({ parts = [], degraded = false, ariaLabel = "修订对照" }) {
  if (degraded) {
    const before = parts.filter((part) => part.type !== "ins").map((part) => part.text).join("");
    const after = parts.filter((part) => part.type !== "del").map((part) => part.text).join("");
    return <div className="revision-diff revision-diff--whole" aria-label={ariaLabel}>
      <div className="revision-diff__whole"><small>原文</small><p>{before}</p></div>
      <div className="revision-diff__whole"><small>改成</small><p className="is-new">{after}</p></div>
    </div>;
  }
  return <p className="revision-diff" aria-label={ariaLabel}>
    {parts.map((part, index) => part.type === "same"
      ? <span key={index}>{part.text}</span>
      : <span key={index} className={part.type === "del" ? "cm-diff-del" : "cm-diff-ins"}>{part.text}</span>)}
  </p>;
}

/**
 * AI 回答卡。**生成新内容和回答问题走这里，不走 diff。**
 *
 * 判据很简单：**这次是在改用户已经写下的字，还是在产出新的字？**
 * 改字（润色 / 纠错 / 缩写 / 扩写）看的是「改完的样子」，所以就地画 diff；
 * 产出新字（空行上的自由指令、续写、想一想、选区上的自由指令）没有「原文」可比，
 * 硬塞进 diff 的结果是答案顶掉原文——用户只是想问一句，正文却被改了。
 *
 * **它就是一条回复。** 所以只有三颗动作：重试 / 在下面插入 / 转到对话，
 * 而且**点别处就是「看完了」**——直接关掉，正文一个字不动。
 *
 * ⚠️ 和候选决策栏的「点别处 = 采纳」**方向正好相反**，这不是不一致：
 * 那边默认结果是「接受这次改动」（用户按下润色时就已经表达了要改），
 * 这边默认结果是「读完就算」（用户只是问了一句，没说要往文章里放）。
 * 默认值都跟着「用户十次里做九次的那个选择」走。
 */
export function AiAnswerCard({ answer, onInsert, onRetry, onDiscuss, onDismiss, onGroundingAction }) {
  const cardRef = useRef(null);
  const rejected = answer.grounding?.gate === "rejected";
  const canLand = !answer.busy && !answer.error && !rejected && Boolean(answer.text?.trim());
  // 点别处 = 看完了。生成中不关——那会儿还没有东西可看。
  useEffect(() => {
    if (answer.busy) return undefined;
    const onPointerDown = (event) => {
      if (cardRef.current?.contains(event.target)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [answer.busy, onDismiss]);
  return <AiAnswerCardBody
    cardRef={cardRef}
    answer={answer}
    rejected={rejected}
    canLand={canLand}
    onInsert={onInsert}
    onRetry={onRetry}
    onDiscuss={onDiscuss}
    onGroundingAction={onGroundingAction}
  />;
}

function AiAnswerCardBody({ cardRef, answer, rejected, canLand, onInsert, onRetry, onDiscuss, onGroundingAction }) {
  return <section ref={cardRef} className="ai-answer" data-status={answer.busy ? "busy" : (answer.error || rejected) ? "failed" : "ready"} aria-label="AI 回答" aria-live="polite">
    <div className="ai-answer__body">
      <span className="ai-answer__avatar" aria-hidden="true">
        {answer.busy ? <DraftingMark size={16} /> : <IconSparkles stroke={1.6} />}
      </span>
      {answer.error
        ? <div className="ai-answer__error"><b>{answer.error.message}</b>{answer.error.hint ? <small>{answer.error.hint}</small> : null}</div>
        : <p>{answer.text || (answer.busy ? "正在生成…" : "")}</p>}
    </div>
    {/**
      * ⚠️ **服务端的真实性 gate 在这里同样是硬闸。**
      * 「在下面插入」是一条**新的**落地路径；不看 `grounding.gate` 就等于给 gate 开后门——
      * 候选那条路拦下来的东西，从卡片这条路照样能写进正文。被拒时只留重试和对话。
      */}
    {rejected ? <p className="ai-answer__gate"><IconAlertTriangle aria-hidden="true" />{answer.grounding.gateDetail || "服务端未放行这段内容"}</p> : null}
    {!answer.busy && answer.grounding && groundingNeedsAttention(answer.grounding)
      ? <div className="ai-answer__grounding"><GroundingReceipt grounding={answer.grounding} onAction={onGroundingAction} /></div>
      : null}
    {/**
      * 三颗图标，靠右。**没有「丢弃」**——点别处就是丢弃，而那是这张卡最常见的结局，
      * 不该占一颗按钮；也没有文字标签，三个图标配 tooltip 就够，
      * 这张卡的主体是那段要读的字，动作条不该和它抢。
      */}
    {answer.busy ? null : <footer className="ai-answer__actions">
      <button type="button" onClick={onRetry} aria-label="重试" title="再生成一次"><IconRefresh aria-hidden="true" stroke={1.7} /></button>
      {canLand ? <button type="button" onClick={onInsert} aria-label="在下面插入" title="插到下面，插入后点别处即落定"><IconRowInsertBottom aria-hidden="true" stroke={1.7} /></button> : null}
      {/* 没接上右栏的场景（比如提示词编辑器）不画这颗——按下去没反应比没有更糟 */}
      {onDiscuss ? <button type="button" onClick={onDiscuss} aria-label="对话" title="把这一问带到右边的 AI 助手里继续聊"><IconMessageCircle aria-hidden="true" stroke={1.7} /></button> : null}
    </footer>}
  </section>;
}

function adoptShortcuts({ blocked, candidate, onAdopt, onDiscard }) {
  return (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === "Enter" && !blocked && candidate.text.trim()) {
      event.preventDefault();
      onAdopt();
    } else if (event.key === "Backspace" && candidate.status !== "generating") {
      event.preventDefault();
      onDiscard();
    }
  };
}

/**
 * 句子 / 选区 / 段落级候选的决策栏。贴在正文里那段 diff 的正下方。
 *
 * 一条栏里只回答三个问题：**改了多大**（+N/−N）、**凭什么**（证据回执）、**要不要**
 * （重试 / 弃用 / 采纳）。「调整要求重新生成」的输入框收进「重试」，因为十次审阅里
 * 九次是直接决定，常驻一个输入框等于每次都要跳过它才看得到那两颗决定键。
 */
export function RevisionDecisionBar({ candidate, degraded = false, persistenceError, adoptOnClickAway = true, onRegenerate, onAdopt, onDiscard, onGroundingAction }) {
  const [instruction, setInstruction] = useState(candidate.instruction || "");
  const attention = groundingNeedsAttention(candidate.grounding);
  const [retryOpen, setRetryOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(attention);
  const barRef = useRef(null);
  useEffect(() => setInstruction(candidate.instruction || ""), [candidate.id, candidate.instruction]);
  // 证据里出现需要处理的东西时自动展开：这是**服务端的结论**，不该藏在一次点击后面。
  useEffect(() => { if (attention) setEvidenceOpen(true); }, [attention, candidate.id]);

  const blocked = candidate.status === "generating" || candidate.status === "failed" || candidate.status === "stale";
  const needsInstruction = candidate.mode === "rewrite" && candidate.source !== "assistant";
  const summary = changeSummary(candidate.original, candidate.text);
  const evidenceCount = candidate.grounding
    ? candidate.grounding.used.length + candidate.grounding.skipped.length + candidate.grounding.unverified.length
    : 0;
  const adoptable = !blocked && Boolean(candidate.text.trim());
  const regenerate = () => {
    if (needsInstruction && !instruction.trim()) return;
    onRegenerate(instruction.trim());
    setRetryOpen(false);
  };

  /**
   * **点别处 = 采纳。** 这是这一屏最重要的一条交互。
   *
   * 上一版必须点「采纳」才落地，于是每一次小改写都要额外一次点击，而那次点击几乎总是「是」——
   * 十次里九次用户读完 diff 就想接着写下一句。现在默认结果就是「接受」：
   * 移开注意力（去正文别处、去右栏）即落定，`✓` 只是显式确认，`弃用` 才是那个需要主动做的动作。
   *
   * ⚠️ **三种状态绝不自动落地**：`generating`（还没有东西）、`stale`（正文已变，会覆盖新内容）、
   * `failed`（服务端真实性 gate 拒绝过）。这条不是手感问题，是硬闸——
   * 那三种情况下点别处只是关掉注意力，候选仍然留在原地等一个明确的决定。
   *
   * ⚠️ **专注审阅（章节 / 全文）关掉这条**（`adoptOnClickAway={false}`）。
   * 那一屏整个就是候选，点进去读、滚动、选中都是审阅动作本身；而且全文替换按产品硬约束
   * 必须明确确认——「移开注意力」在那儿不构成同意。
   */
  useEffect(() => {
    if (!adoptable || !adoptOnClickAway) return undefined;
    const onPointerDown = (event) => {
      if (barRef.current?.contains(event.target)) return;
      onAdopt();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [adoptable, adoptOnClickAway, onAdopt]);

  return <section
    ref={barRef}
    className="revision-bar"
    data-status={candidate.status}
    data-attention={attention || undefined}
    aria-label={candidate.label.endsWith("候选") ? candidate.label : `${candidate.label}候选`}
    aria-live="polite"
    onKeyDown={adoptShortcuts({ blocked, candidate, onAdopt, onDiscard })}
  >
    <div className="revision-bar__row">
      <span className="revision-bar__label">
        {candidate.status === "generating" ? <DraftingMark size={16} /> : <IconSparkles aria-hidden="true" stroke={1.7} />}
        <b>{candidate.label}</b>
      </span>
      <span className="revision-bar__stat">
        {candidate.status === "generating"
          ? "正在生成…"
          : `${summary.label}${candidate.generations?.length > 1 ? ` · 第 ${candidate.generations.length} 版` : ""}${degraded ? " · 整段替换" : ""}`}
      </span>
      {evidenceCount ? <button
        type="button"
        className="revision-bar__evidence"
        data-open={evidenceOpen || undefined}
        aria-expanded={evidenceOpen}
        onClick={() => setEvidenceOpen((open) => !open)}
      >
        <IconShieldCheck aria-hidden="true" stroke={1.7} />证据 {evidenceCount}<IconChevronDown aria-hidden="true" stroke={1.8} />
      </button> : null}
      {/**
        * 三颗动作，按「越往右越是终局」排：重试 → 弃用 → 采纳。
        *
        * 弃用和采纳收成**圆形图标键**（Notion 的 ↺ / ✓）：默认结果已经是采纳，
        * 这两颗是「改主意」和「确认」，不需要再各占一块写着字的按钮把这条栏撑满。
        * 名字进 `aria-label` 和 tooltip，不进视觉。
        */}
      <div className="revision-bar__actions">
        <button type="button" className="revision-bar__retry" data-on={retryOpen || undefined} onClick={() => setRetryOpen((open) => !open)} disabled={candidate.status === "generating"} aria-expanded={retryOpen} title="补充要求后重新生成">
          <IconRefresh aria-hidden="true" stroke={1.7} />重试
        </button>
        <button type="button" className="revision-bar__decide" onClick={onDiscard} disabled={candidate.status === "generating"} aria-label="弃用" title="弃用，恢复原文 · Ctrl/⌘+Backspace">
          <IconArrowBackUp aria-hidden="true" stroke={1.8} />
        </button>
        <button type="button" className="revision-bar__decide is-primary" onClick={onAdopt} disabled={!adoptable} aria-label="采纳" title="采纳 · Ctrl/⌘+Enter（点正文别处同样采纳）" aria-keyshortcuts="Control+Enter Meta+Enter">
          <IconCheck aria-hidden="true" stroke={2.2} />
        </button>
      </div>
    </div>
    {candidate.status === "stale" ? <p className="revision-bar__note is-warn"><IconAlertTriangle aria-hidden="true" />正文已在候选生成后变化。请重新生成，避免覆盖新内容。</p> : null}
    {candidate.status === "failed" || candidate.error ? <p className="revision-bar__note is-bad"><IconAlertTriangle aria-hidden="true" /><span><b>{candidate.error?.message || candidate.grounding?.gateDetail || "候选没有生成"}</b>{candidate.error?.hint ? <small>{candidate.error.hint}</small> : null}</span></p> : null}
    {retryOpen ? <div className="revision-bar__command">
      <input
        autoFocus
        value={instruction}
        maxLength={500}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); setRetryOpen(false); return; }
          if (!event.nativeEvent?.isComposing && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); regenerate(); }
        }}
        placeholder={candidate.mode === "rewrite" ? "调整改写要求后重新生成" : "可补充具体要求后重新生成"}
        aria-label="调整候选要求"
      />
      <button type="button" onClick={regenerate} disabled={needsInstruction && !instruction.trim()} aria-label="按当前要求重新生成" title="按当前要求重新生成">
        <IconSend aria-hidden="true" stroke={1.8} />
      </button>
    </div> : null}
    {evidenceOpen ? <GroundingReceipt grounding={candidate.grounding} onAction={onGroundingAction} /> : null}
    {/**
      * ⚠️ **脚注只在真出事时出现。**
      *
      * 上一版常驻一行「内容由 AI 生成 · 待审阅 · 采纳前不会写入正文」——三句话都是恒定值，
      * 而且都已经被别的东西说过了：AI 图标 + 动作名说了是 AI 生成的，正文里的 diff 说了
      * 还没写进去，状态说了在等审阅。三句恒定的话占掉一整行，等于把这条栏撑高一倍去说
      * 一件用户第二次就不会再读的事。
      */}
    {persistenceError ? <small className="revision-bar__foot is-bad">候选历史未保存：{persistenceError}</small> : null}
  </section>;
}

/** 章节 / 全文级：折叠右栏后的专注审阅。正文太长，diff 在这里单栏铺开读。 */
export function CandidateCard({ candidate, persistenceError, onRegenerate, onAdopt, onDiscard, onGroundingAction }) {
  const { parts, degraded } = candidate.status === "generating"
    ? { parts: [], degraded: false }
    : diffTokens(candidate.original, candidate.text);
  return <section className="candidate-card" data-status={candidate.status} aria-label={candidate.label.endsWith("候选") ? candidate.label : `${candidate.label}候选`}>
    {candidate.status === "generating"
      ? <div className="candidate-card__loading"><DraftingMark size={16} /><span>正在保持原意，生成可比较的新版本…</span></div>
      : <RevisionDiff parts={parts} degraded={degraded} ariaLabel="正文候选对照" />}
    <RevisionDecisionBar
      candidate={candidate}
      degraded={degraded}
      adoptOnClickAway={false}
      persistenceError={persistenceError}
      onRegenerate={onRegenerate}
      onAdopt={onAdopt}
      onDiscard={onDiscard}
      onGroundingAction={onGroundingAction}
    />
  </section>;
}
