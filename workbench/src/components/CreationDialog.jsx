import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { cleanGeneratedDraft, creationApi, deriveDraftTitle, interviewStream } from "../lib/creation-api.js";
import { readStats } from "../lib/reading.js";
import { verificationBadge } from "../lib/sources.js";
import { PLATFORMS } from "../lib/platforms.js";
import { startWriting } from "../lib/start-writing.js";
import { ErrorNote, Select, valueIcon } from "./ui.jsx";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconFileText,
  IconLoader2,
  IconMessageQuestion,
  IconNotebook,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSend,
  IconSparkles,
  IconStack2,
  IconUsers,
  IconWorld,
  IconX,
} from "./icons.jsx";
import "./creation.css";

/**
 * 打开时落在哪一屏。
 *
 * ⚠️ **这个弹层里已经没有编辑器了。** 它只剩「起稿准备」：挑素材、访谈、新建选题。
 * 写作统一在 `#/project/:id`（见 `lib/start-writing.js`）——同一件事（写字）
 * 曾经有两个界面，而那两个界面的能力还不一样。
 *
 * 所以 `blank` 不在这儿：空白文章根本不开弹层，`NewContentButton` 里选完平台
 * 就直接建项目跳过去了。认不出的 preset 一律当成「从素材开始」，
 * 而不是退回一个已经不存在的「起点选择」屏。
 */
const firstScreen = (preset) =>
  preset === "topic" ? "topic"
  : preset === "interview" ? "interview"
  : "material";

export function CreationDialog({ open, preset, onClose, onStarted, onTopicCreated }) {
  const [screen, setScreen] = useState(firstScreen(preset));
  const [draftMode, setDraftMode] = useState("blank");
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("公众号");
  const [viewpoint, setViewpoint] = useState("");
  const [audience, setAudience] = useState("");
  const [query, setQuery] = useState("");
  const [materials, setMaterials] = useState([]);
  const [selected, setSelected] = useState([]);
  const [interviewEvidence, setInterviewEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState("interviewing");
  /**
   * AI 起稿的结果：`{ body, title, skipped }`。**它停在素材那一屏上，不跳走。**
   *
   * ⚠️ **`skipped` 必须在跳走之前让人看见。** 待核验的金句和数据不进稿，
   * 挑了 5 条只用了 3 条——不说的话用户以为模型漏用了。跳进项目页再说就晚了：
   * 那一页没有地方讲「刚才生成时发生了什么」，而 Worker 也不存这件事。
   */
  const [generated, setGenerated] = useState(null);
  // 目标读者的预设清单（服务端 config/audiences.json）。取不到就是空数组——
  // 那时这一格退化成一个普通输入框，仍然能填，不挡路
  const [audiences, setAudiences] = useState([]);
  const abortRef = useRef(null);
  const sessionRef = useRef("");

  const close = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);
  const boxRef = useDialog(open, close, { autoFocus: true });

  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    sessionRef.current = "";
    setScreen(firstScreen(preset));
    setDraftMode("blank");
    setTitle(""); setPlatform("公众号"); setViewpoint(""); setAudience("");
    setQuery(""); setMaterials([]); setSelected([]); setGenerated(null);
    setInterviewEvidence(""); setBusy(false); setError(null); setMessages([]); setMessage(""); setPhase("interviewing");
  }, [open, preset]);

  // 预设清单只取一次。取不到不报错也不挡路：那一格照旧能手打
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    creationApi.audiences()
      .then((r) => !cancelled && setAudiences(r.items || []))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || screen !== "material") return;
    const q = query.trim();
    if (!q) return setMaterials([]);
    let cancelled = false;
    const timer = setTimeout(() => creationApi.searchMaterials(q)
      .then((result) => !cancelled && setMaterials(result.items || []))
      .catch((err) => !cancelled && setError(err)), 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, screen, query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const answers = useMemo(() => messages.filter((item) => item.role === "user" && !item.control), [messages]);
  const summary = useMemo(() => {
    if (phase !== "summary" && phase !== "drafting") return "";
    return [...messages].reverse().find((item) => item.role === "agent")?.text || "";
  }, [messages, phase]);

  if (!open) return null;

  /**
   * 用过的目标读者记进预设，下次就在下拉里。**失败一律吞掉**——
   * 它是主动作的一个副作用，不能因为记不下来就让「稿子建好了」变成一句报错。
   */
  function keepAudience() {
    const value = audience.trim();
    if (!value) return;
    creationApi.rememberAudience(value).catch(() => {});
  }

  async function createTopic() {
    if (!title.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await creationApi.create({ kind: "topic", mode: "blank", title, platform, viewpoint, audience });
      keepAudience();
      onTopicCreated?.(result.topic, result.project);
      close();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 准备完了，开始写。**这是这个弹层的出口，也是唯一的出口。**
   *
   * ⚠️ **建完项目就跳到 `#/project/:id`，不在这儿写字。**
   * 写作只有一个地方——同一件事曾经有两个界面（弹层里的编辑器和项目页），
   * 而那两个界面的能力还不一样：项目页有素材栏、有发布准备、有阶段推进，弹层没有。
   * 用户的原话是「写作应该统一使用一个页面吧」。
   */
  async function beginWriting({ mode, body = "", title: suggested = "", evidence = "" }) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      keepAudience();
      const projectId = await startWriting({
        platform,
        mode,
        title: suggested || title.trim(),
        body,
        viewpoint,
        audience,
        materialIds: selected.map((item) => item.id),
        // 访谈那条传的是闭包里的证据：`setInterviewEvidence` 这一帧还没生效
        interviewEvidence: evidence || interviewEvidence,
      });
      onStarted?.(projectId);
      close();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function sendInterview(text, { control = false, nextPhase = phase, after } = {}) {
    const value = String(text || "").trim();
    if (!value || busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const token = `${Date.now()}-${Math.random()}`;
    setMessages((items) => [...items, { role: "user", text: value, control }, { role: "agent", text: "", token }]);
    setMessage(""); setBusy(true); setError(null);
    interviewStream({
      signal: ac.signal,
      sessionId: sessionRef.current,
      message: value,
      title: title.trim() || deriveDraftTitle("", value),
      platform,
      phase,
      onSession: (id) => { if (id) sessionRef.current = id; },
      onChunk: (full) => setMessages((items) => items.map((item) => item.token === token ? { ...item, text: full } : item)),
    }).then(async (full) => {
      setMessages((items) => items.map((item) => item.token === token ? { ...item, text: full } : item));
      setPhase(nextPhase);
      await after?.(full);
    }).catch((err) => {
      if (err.name !== "AbortError") setError(err);
    }).finally(() => setBusy(false));
  }

  function startMaterialDraft() {
    if (busy || !selected.length || !viewpoint.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    keepAudience();
    setDraftMode("material");
    // ⚠️ **生成期间留在这一屏**，不跳走。它要等几十秒（整篇收齐 + 过完真实性闸门），
    // 而写完之后还有一句话必须让人看见（剔掉了哪几条）——跳进项目页就没地方说了。
    setGenerated(null);
    setBusy(true);
    setError(null);
    /**
     * ⚠️ **这条不流式，是有意的。**
     *
     * Worker 那边要把整篇收齐、过完真实性闸门（`assertGroundedGeneratedText`）才放行——
     * 边写边显示的话，被判定为编造的那段用户**已经读完了**，事后撤掉等于没拦。
     * 代价是要对着等待态等几十秒，所以那个等待态必须说清此刻在干什么。
     *
     * 只传素材 id，不传素材正文：闸门拿「个人经历」类素材当证据，
     * 证据要是客户端给的，编一条假的就能把闸门整个绕开。
     */
    creationApi.draftFromMaterials({
      materialIds: selected.map((item) => item.id),
      draftTitle: title.trim(),
      platform,
      viewpoint: viewpoint.trim(),
      audience: audience.trim(),
    }, ac.signal).then((result) => {
      setGenerated({
        body: result.body || "",
        title: title.trim() || deriveDraftTitle("", result.body || ""),
        // 剔掉的素材要说出来：挑了 5 条只用了 3 条，不说的话用户会以为模型漏用了
        skipped: result.skipped || [],
      });
    }).catch((err) => {
      if (err.name !== "AbortError") setError(err);
    }).finally(() => setBusy(false));
  }

  function confirmDraft() {
    const evidence = [
      ...answers.map((item) => `用户：${item.text}`),
      summary ? `\n用户已确认的访谈共识：\n${summary}` : "",
    ].filter(Boolean).join("\n\n");
    setPhase("drafting");
    sendInterview("【工作台动作：生成初稿】我确认上一轮访谈共识准确。请按已确认内容生成初稿。", {
      control: true,
      nextPhase: "drafting",
      after: async (full) => {
        const body = cleanGeneratedDraft(full);
        setInterviewEvidence(evidence);
        /**
         * ⚠️ **访谈这条直接跳，不像素材那条停一下。**
         * 差别在于「有没有话必须先说」：素材起稿会剔掉素材，那句话跳走就没地方说了；
         * 访谈的初稿你刚刚一行行看着它流出来，没有任何新信息要交代。
         *
         * `interviewEvidence` 靠闭包里的 `evidence` 直接传——`setInterviewEvidence`
         * 这一帧还没生效，读 state 会拿到空串，而那正是真实性闸门要的证据。
         */
        await beginWriting({ mode: "interview", body, title: deriveDraftTitle("", body), evidence });
      },
    });
  }

  const heading = screen === "topic" ? "新建选题"
    : screen === "material" ? "从素材开始"
      : screen === "interview" ? "访谈起稿"
        : "开始创作";

  /**
   * ⚠️ **这个弹层现在只有一层，所以没有返回。**
   *
   * 「起点选择」那一屏整个撤了——问三选一的活已经在页头那颗下拉里干完了
   *（`NewContentButton`），而每一屏都是 `preset` 直接指定的入口。
   * 面包屑仍然留在结构里（`back` 恒为 null），因为**加第四屏时它还得回来**：
   * 退到哪一层由这一处算出来，别再各屏就地画一颗。
   */
  const back = null;

  return (
    // ⚠️ **虚化深度跟着屏走**（`data-deep`）：选起点时背后那一页还是「你刚才在看的东西」，
    // 该认得出来；进了编辑器之后它只剩噪音，糊掉才写得进去。深浅之间给一段过渡，
    // 那一下渐深本身就是「现在开始写了」的信号。
    <div
      className="scrim scrim--center creation-scrim"
      data-deep={screen === "interview" ? "true" : "false"}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      {/**
        * ⚠️ **`data-stage` 只有访谈屏在用，管的是「这个弹层此刻该多高」。**
        *
        * 还没开口时这一屏的全部内容是一句引导 + 三颗起手句 + 输入框——撑到 720px
        * 就是一栋空房子（截图里上半屏整片空白，那正是「这个页面不行」的来源）。
        * 所以开场不设高度，由内容决定；发出第一句之后再定高，
        * 让对话流有一块**固定不跳**的地方可滚。
        */}
      <section className="creation" data-screen={screen} data-mode={draftMode}
        data-stage={screen === "interview" ? (messages.length ? "live" : "start") : undefined}
        ref={boxRef} role="dialog" aria-modal="true" aria-label={heading}>
        <header className="creation__head">
          {/**
            * **返回就长在眉标那一行上，不另画一颗按钮。**
            *
            * 上一版是标题左边一颗方形图标按钮——它和标题抢左上角那个位置，看着像贴上去的。
            * 而这一行本来就有个 `// CREATE`，那是句装饰；换成**面包屑**之后同一行同时回答了
            * 「我在哪」和「怎么退回去」，还多说了一件事：**退回去是哪儿**（起稿方式 /
            * 从素材开始 / 访谈起稿），而一个光秃秃的箭头说不了这个。
            */}
          <div>
            {back ? (
              <button className="creation__crumb" onClick={back.go} title={`返回${back.label}`}>
                <IconArrowLeft aria-hidden="true" />{back.label}
              </button>
            ) : (
              <span className="eyebrow">CREATE</span>
            )}
            <h2>{heading}</h2>
          </div>
          {/* 访谈屏的平台选择长在眉标行上。它是这一屏唯一的设置项，为它单开一栏
              等于用 270px 换一个下拉——而那一栏剩下的地方全是空的。 */}
          {screen === "interview" ? <PlatformSelect value={platform} onChange={setPlatform} /> : null}
          <button className="icon-btn" onClick={close} aria-label="关闭" title="关闭（Esc）"><IconX aria-hidden="true" /></button>
        </header>

        {screen === "topic" ? (
          <TopicForm title={title} setTitle={setTitle} platform={platform} setPlatform={setPlatform}
            viewpoint={viewpoint} setViewpoint={setViewpoint} audience={audience} setAudience={setAudience}
            audiences={audiences} busy={busy} onSubmit={createTopic} />
        ) : null}

        {screen === "material" ? (
          <MaterialSetup title={title} setTitle={setTitle} platform={platform} setPlatform={setPlatform}
            viewpoint={viewpoint} setViewpoint={setViewpoint} audience={audience} setAudience={setAudience}
            audiences={audiences}
            query={query} setQuery={setQuery} materials={materials} selected={selected} setSelected={setSelected}
            busy={busy}
            generated={generated} onDiscardGenerated={() => setGenerated(null)}
            onWrite={() => beginWriting({ mode: "material" })}
            onGenerate={startMaterialDraft}
            onUseGenerated={() => beginWriting({ mode: "material", body: generated.body, title: generated.title })} />
        ) : null}

        {screen === "interview" ? (
          <Interview messages={messages} message={message} setMessage={setMessage}
            phase={phase} busy={busy} answers={answers.length}
            onSend={() => sendInterview(message, { nextPhase: phase === "summary" ? "interviewing" : phase })}
            onSummarize={() => sendInterview("【工作台动作：整理共识】请只根据以上对话整理访谈共识，等待我确认，不要开始写文章。", { control: true, nextPhase: "summary" })}
            onConfirm={confirmDraft} />
        ) : null}


        <ErrorNote error={error} what="创建" />
      </section>
    </div>
  );
}

/**
 * 起点选择：三张并排的卡。
 *
 * 卡片这个形态是对的——三个起点是**平行的三条路**，并排摆本身就在说这件事。原来那版难看
 * 的地方只有一个：卡子写死 142px 高、图标钉在左上角、文字用 `margin-top:auto` 沉到底部，
 * 中间挖出一块谁也不属于的空白。**现在不设固定高度，内容从上往下自然排**，卡有多高由字决定。
 *
 * **小字（想到就写 / 手上有料 / 只有想法）排在标题前面**：上一句问的就是「你此刻是哪种
 * 状态」，人是照着状态挑的，不是照着功能名挑的。三个词还构成一条完整的轴。
 *
 * 数字键 1/2/3 直接选，键号画在卡的右上角。这一屏没有输入框，裸键不会和打字打架
 * （和全局那条「裸键 `n` 在输入框里绝不触发」是同一条规矩的另一面）。
 */
/**
 * 起稿的三个起点。
 *
 * ⚠️ **导出给页头那颗「新建」下拉用**（`MenuButton`）。别在那边抄第二份：
 * 抄了的话，改一个起点的说明要改两处，而漏掉的那处不报错——
 * 这个项目的事故清一色是「同一件事写在两个地方」。
 *
 * 下拉里点一条 = 直接进那一屏（`preset`），**跳过「起点选择」那一屏**：
 * 那一屏原来的全部作用就是问这三选一，而下拉已经问过了。
 */
export const MODES = [
  { key: "blank", icon: IconFileText, title: "空白文章", hint: "打开编辑器，标题最后再想。", mark: "想到就写" },
  { key: "material", icon: IconStack2, title: "从素材开始", hint: "先挑依据，再决定谁来写。", mark: "手上有料" },
  { key: "interview", icon: IconMessageQuestion, title: "访谈起稿", hint: "边聊边把想法梳成初稿。", mark: "只有想法" },
];

function PlatformSelect({ value, onChange }) {
  return (
    <span className="creation-platform">
      <Select
        value={value}
        options={PLATFORMS}
        onChange={onChange}
        ariaLabel="发布平台"
        title="选择发布平台"
        renderIcon={(item) => {
          const Icon = valueIcon(item, IconWorld);
          return <Icon size={15} stroke={1.8} aria-hidden="true" />;
        }}
      />
    </span>
  );
}

/**
 * 目标读者：**能选也能打**。
 *
 * 做成纯下拉的话，遇到清单里没有的读者就没路可走；做成纯输入框（原来那样）则是每次都得
 * 重打一遍同一句话——而一个人常写的读者其实就那么三五种。所以是个 combobox：
 * 输入框照常打字，右边的箭头展开预设，打字时顺带筛。
 *
 * **清单自己会长**：用过一次的下次就在里面（`keepAudience`），不需要先去哪个设置页添加。
 *
 * ⚠️ **Esc 要在捕获阶段吞掉**（和 `ui.jsx` 的 `Select` 同一条）：不吞的话，收起这个菜单的
 * 那一下会顺着冒泡把整个创作弹层关掉——而用户以为自己只是收了个下拉。
 */
function AudienceField({ value, onChange, options = [], label = "目标读者", placeholder = "可选，写给谁看" }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  // ⚠️ **菜单必须 `position: fixed`，不能跟着字段绝对定位。**
  // 这一格住在右栏里，而右栏是个 `overflow-y: auto` 的滚动容器——绝对定位的菜单会被它
  // **裁成一条几像素的白边**（现象就是「点了下拉，底下闪出一条白杠」）。改浮层的层级、
  // z-index 都没用：裁剪是 overflow 干的，和层级无关。
  const [place, setPlace] = useState(null);
  const ref = useRef(null);
  const boxRef = useRef(null);

  const measure = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    // 下面放不下就往上开。240 是菜单的大致高度，宁可估大——估小的代价是菜单探出屏幕
    const up = below < 240 && r.top > below;
    // ⚠️ **向右对齐、向左长**：预设是整句话（「想用 AI 提效的独立开发者」），比这一格宽。
    // 按字段宽度写死 `width` 的话，每一条都被截掉半句——那正是这个下拉存在的意义（一眼看清
    // 写给谁），截了就等于没有。所以给 `minWidth` 不给 `width`，再从右边缘往左长。
    setPlace({
      right: Math.round(window.innerWidth - r.right),
      minWidth: Math.round(r.width),
      top: up ? undefined : Math.round(r.bottom + 6),
      bottom: up ? Math.round(window.innerHeight - r.top + 6) : undefined,
    });
  };
  const typed = String(value || "").trim().toLowerCase();
  // 打了字就把清单收窄到还对得上的那几条；一条都对不上就不弹（弹一个空菜单等于挡住视线）
  const list = useMemo(
    () => (typed ? options.filter((item) => item.toLowerCase().includes(typed)) : options),
    [options, typed]
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
      if (e.key === "Enter" && at < 0) return;   // 没在菜单里挑就让回车照常提交
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter") {
        onChange(list[at]);
        setOpen(false);
        return;
      }
      const n = list.length;
      if (!n) return;
      setAt((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    };
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onMove, true);   // 捕获阶段：右栏自己那条滚动条也算
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, at, list, onChange]);

  const show = () => { measure(); setOpen(true); };

  return (
    <div className="creation-brief-field creation-audience" ref={ref}>
      <span>{label}</span>
      <div className="creation-audience__box" ref={boxRef}>
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setAt(-1); if (options.length) show(); }}
          onFocus={() => options.length && show()}
          placeholder={placeholder}
        />
        {options.length ? (
          <button
            type="button"
            className="creation-audience__toggle"
            onClick={() => { setAt(-1); open ? setOpen(false) : show(); }}
            aria-expanded={open}
            aria-label="选一个用过的目标读者"
            title="选一个用过的目标读者"
          >
            <IconChevronDown aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {open && list.length && place ? (
        <div
          className="select__pop creation-audience__pop"
          role="listbox"
          // ⚠️ `left: "auto"` 不能省：`.select__pop` 基类里写着 `left: 0`，左右同时有值时
          // 浏览器按「过约束」处理、**保留 left 丢掉 right**——现象是菜单飞到屏幕最左边
          style={{ position: "fixed", left: "auto", right: place.right, minWidth: place.minWidth, top: place.top, bottom: place.bottom }}
        >
          {list.map((item, index) => (
            <button
              key={item}
              type="button"
              data-at={index === at ? "1" : undefined}
              aria-selected={item === value}
              onMouseEnter={() => setAt(index)}
              onClick={() => { onChange(item); setOpen(false); }}
            >
              <IconUsers size={15} stroke={1.8} aria-hidden="true" />
              <span>{item}</span>
              {item === value ? <IconCheck className="select__tick" size={15} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TopicForm({ title, setTitle, platform, setPlatform, viewpoint, setViewpoint, audience, setAudience, audiences, busy, onSubmit }) {
  return (
    <div className="creation-form creation-form--topic">
      <div className="creation-form__grid">
        <label className="field creation-form__wide"><span>选题标题</span><input data-autofocus="" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="这篇准备讨论什么" /></label>
        <label className="field"><span>发布平台</span><PlatformSelect value={platform} onChange={setPlatform} /></label>
        <AudienceField value={audience} onChange={setAudience} options={audiences} label="目标读者（可选）" placeholder="主要写给谁" />
        <label className="field creation-form__wide"><span>核心观点（可选）</span><textarea value={viewpoint} onChange={(e) => setViewpoint(e.target.value)} placeholder="希望读者最终记住什么" /></label>
      </div>
      <div className="creation-form__foot creation-form__foot--end"><button className="btn btn-primary" onClick={onSubmit} disabled={busy || !title.trim()}>{busy ? "建立中…" : "建立选题"}</button></div>
    </div>
  );
}

/** 素材列表里的一行。关键词命中和 AI 挑出来的共用它，只多一句「为什么是它」。 */
function MaterialRow({ item, on, onToggle, why }) {
  return (
    <button aria-pressed={on} onClick={onToggle}>
      <span>{item.title}</span>
      <small>{item.type}{verificationBadge(item.verificationStatus) ? ` · ${verificationBadge(item.verificationStatus)}` : ""}</small>
      {why ? <em>{why}</em> : null}
      {on ? <IconCheck aria-hidden="true" /> : <IconPlus aria-hidden="true" />}
    </button>
  );
}

function MaterialSetup({ title, setTitle, platform, setPlatform, viewpoint, setViewpoint, audience, setAudience, audiences, query, setQuery, materials, selected, setSelected, busy, generated, onWrite, onGenerate, onUseGenerated, onDiscardGenerated }) {
  const toggle = (item) => setSelected((items) => items.some((picked) => picked.id === item.id) ? items.filter((picked) => picked.id !== item.id) : [...items, item]);
  const isOn = (item) => selected.some((picked) => picked.id === item.id);
  const q = query.trim();

  /**
   * 「按意思找」的结果。**`for` 记的是这一批是给哪个词找的**——不记的话，改了搜索词之后
   * 上一批推荐还挂在下面，看着像是新词的结果。
   */
  const [ai, setAi] = useState({ items: [], busy: false, error: null, for: "", scanned: 0 });
  const shown = ai.for === q && (ai.busy || ai.error || ai.items.length || ai.scanned);

  /**
   * ⚠️ **关键词已经搜出来的，不能再出现在 AI 那一栏里。**
   *
   * 这一步补的是「关键词搜不到」那个缺口。同一条素材在上下两栏各出现一次，对用户是
   * 纯噪音（他刚在上面选过它），而且它还占掉了 AI 那 6 个名额里的一个。
   *
   * 排除清单送给 Worker（在候选阶段就拿掉，模型能腾出名额挑别的），
   * 这里再兜一层过滤——模型不听话时，把关拦在最后一道。
   */
  async function askAi() {
    if (!q || ai.busy) return;
    setAi({ items: [], busy: true, error: null, for: q, scanned: 0 });
    const seen = new Set(materials.map((item) => item.id));
    try {
      const result = await creationApi.pickMaterials({
        want: q, viewpoint: viewpoint.trim(), platform, exclude: [...seen],
      });
      setAi({
        items: (result.items || []).filter((item) => !seen.has(item.id)),
        busy: false, error: null, for: q, scanned: result.scanned || 0,
      });
    } catch (error) {
      setAi({ items: [], busy: false, error, for: q, scanned: 0 });
    }
  }

  return (
    <div className="creation-material-workspace">
      <section className="creation-material-browser">
        <div className="creation-section-title"><div><span className="eyebrow">01 · EVIDENCE</span><h3>挑选真正会用到的素材</h3></div><small>已选 {selected.length}</small></div>
        <label className="creation-material-search"><IconSearch aria-hidden="true" /><input data-autofocus="" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材标题或正文" /></label>
        <div className="creation-material-list">
          {!q ? <div className="creation-material-empty"><IconSearch aria-hidden="true" /><strong>搜索你的素材库</strong><p>输入关键词，把这篇真正要用的依据收进右侧。</p></div> : null}

          {materials.map((item) => <MaterialRow key={item.id} item={item} on={isOn(item)} onToggle={() => toggle(item)} />)}

          {/* ⚠️ **搜不到不是终点，是分岔口。** 「换一个关键词试试」把活儿又推回给用户，
              而这恰恰是他刚试过一次的事。关键词对不上不代表库里没有——搜「成长」的时候，
              那条「复利不是利滚利」正是想要的，只是它一个字都没提「成长」。 */}
          {q && !materials.length && !shown ? (
            <div className="creation-material-empty">
              <IconSearch aria-hidden="true" />
              <strong>没有标题或正文里带「{q}」的素材</strong>
              <p>关键词对不上，不等于库里没有。让 AI 通读一遍素材库，按意思挑几条。</p>
              <button className="btn btn-sm" onClick={askAi}><IconSparkles aria-hidden="true" />让 AI 按意思找</button>
            </div>
          ) : null}

          {/* 有结果的时候它只是一条安静的补充，不抢关键词搜这条默认路径 */}
          {q && materials.length && !shown ? (
            <button className="btn btn-quiet creation-ai-more" onClick={askAi}>
              <IconSparkles aria-hidden="true" />没找到想要的？让 AI 按意思找
            </button>
          ) : null}

          {shown ? (
            <div className="creation-ai-picks">
              <header>
                <IconSparkles aria-hidden="true" />
                <b>AI 按意思挑的</b>
                {ai.scanned ? <small>通读了 {ai.scanned} 条素材</small> : null}
              </header>
              {ai.busy ? (
                // ⚠️ **等待文案要跟着链路改。** 这条曾经走本机 CLI（十几秒），文案也照实写着
                // 「要把 CLI 拉起来」；后来整件事挪去 Worker（库和 LLM 代理都在那儿，秒级），
                // 而这句话留在了原地——**说的是一条已经不存在的链路**。改实现时把它一起改掉。
                <p className="creation-ai-wait"><IconLoader2 className="spin" aria-hidden="true" />正在通读素材库，按意思挑几条…</p>
              ) : ai.error ? (
                <ErrorNote error={ai.error} what="AI 挑素材" />
              ) : ai.items.length ? (
                ai.items.map((item) => <MaterialRow key={`ai-${item.id}`} item={item} on={isOn(item)} onToggle={() => toggle(item)} why={item.why} />)
              ) : (
                // 挑不出来是正常结果，不是失败。说清「它确实找过了」，别让人以为功能坏了。
                // 上面有关键词结果时要说成「没有**关键词之外的**」——那是个有信息量的结论
                //（说明关键词已经搜全了），而不是「什么都没找到」
                <p className="creation-ai-none">
                  {materials.length
                    ? `通读完了，关键词之外没有别的和「${ai.for}」相关的素材——上面那 ${materials.length} 条就是全部。`
                    : `通读完了，确实没有和「${ai.for}」相关的素材。`}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <aside className="creation-material-plan">
        <div className="creation-section-title"><div><span className="eyebrow">02 · BRIEF</span><h3>确定怎么写</h3></div><PlatformSelect value={platform} onChange={setPlatform} /></div>
        {/* 已选素材是**一排芯片**，不是一列带边框的行。
            空着的时候只留一行小字：那句「选中的素材会留在这里，进入编辑器后仍会持续显示」
            占了 128px 的高度去讲一件**做一次就懂**的事，而这一栏最缺的就是高度。 */}
        <div className="creation-picked" data-empty={selected.length ? undefined : "true"}>
          {!selected.length ? <span className="creation-picked__none">还没选素材 · 在左边挑</span> : selected.map((item) => (
            <span className="creation-chip" key={item.id}>
              <IconNotebook aria-hidden="true" />
              <b title={item.title}>{item.title}</b>
              <button onClick={() => toggle(item)} aria-label={`移除${item.title}`}><IconX aria-hidden="true" /></button>
            </span>
          ))}
        </div>
        {/* 文章方向吃掉多出来的高度：它是 AI 起稿的必填项，也是这一栏里最该多给地方的一格。
            让它长，比在下面留一块空白强 */}
        <label className="creation-brief-field creation-brief-field--grow"><span>文章方向 <em>AI 起稿时必填</em></span><textarea value={viewpoint} onChange={(e) => setViewpoint(e.target.value)} placeholder="这篇想说清什么？哪些判断不能偏离？" /></label>
        <div className="creation-brief-row">
          <label className="creation-brief-field"><span>暂定标题</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="可最后再写" /></label>
          <AudienceField value={audience} onChange={setAudience} options={audiences} />
        </div>
        {/**
          * 三态：**在生成 / 生成完了 / 还没开始**。
          *
          * ⚠️ **生成完那一态不能跳过。** 待核验的金句和数据不进稿，
          * 挑了 5 条只用了 3 条——这句话跳进项目页就没地方说了（那一页
          * 没有「刚才生成时发生了什么」这个概念，Worker 也不存它）。
          * 所以这一屏在这儿停一下，把结果说清楚再走。
          */}
        {busy && !generated ? (
          <div className="creation-generating" role="status">
            <IconLoader2 className="spin" aria-hidden="true" />
            <span>
              <strong>正在写…</strong>
              {/* 说清此刻在等什么：这条不流式是有意的，等几十秒是正常的 */}
              <small>写完会先整篇过一遍真实性校验再给你，所以要等一会儿。</small>
            </span>
          </div>
        ) : generated ? (
          <div className="creation-generated">
            <p className="creation-generated__head">
              <IconCheck aria-hidden="true" />
              <strong>初稿写好了</strong>
              <em>{readStats(generated.body).words} 字</em>
            </p>
            {generated.skipped.length ? (
              <p className="creation-generated__skip">
                <IconAlertTriangle aria-hidden="true" />
                有 {generated.skipped.length} 条没进稿（待核验的金句和数据不会被引用）：
                {generated.skipped.map((item) => item.title || item).join("、")}
              </p>
            ) : (
              <p className="creation-generated__skip creation-generated__skip--ok">选中的 {selected.length} 条素材都用上了。</p>
            )}
            <div className="creation-generated__acts">
              <button className="btn" onClick={onDiscardGenerated} disabled={busy}>重写一版</button>
              <button className="btn btn-primary" onClick={onUseGenerated} disabled={busy}>
                {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconPencil aria-hidden="true" />}去写
              </button>
            </div>
          </div>
        ) : (
          <div className="creation-writing-paths">
            <button onClick={onWrite} disabled={busy || !selected.length}>
              <IconPencil aria-hidden="true" /><span><strong>带着素材自己写</strong><small>建一篇空稿，素材挂在项目里，写的时候随时插入。</small></span><IconArrowLeft className="creation-path-arrow" aria-hidden="true" />
            </button>
            <button className="is-primary" onClick={onGenerate} disabled={busy || !selected.length || !viewpoint.trim()}>
              <IconSparkles aria-hidden="true" /><span><strong>让 AI 生成初稿</strong><small>只使用上面的简报与已选素材。</small></span><IconArrowLeft className="creation-path-arrow" aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * 每一步在做什么，**照实说一句**。
 *
 * 原来这儿是一句写死的「至少完成两轮回答后，可以随时整理共识」，从头挂到尾——
 * 而这一屏真正会变的正是「现在轮到你做什么」。同一块地方在三个阶段说三句话，
 * 比一句放之四海皆准的说明有用得多（「反馈引导行动」那条）。
 *
 * ⚠️ **每句都要短到能和步骤条、动作按钮并排放在一行里。** 长句会把这一行挤成两行，
 * 而它压在输入框正上方——那儿多一行，输入框就矮一行。开场那段完整的引导话
 * （「先随便说，不用组织语言……」）在欢迎区里已经说过一遍了，这里不重复。
 */
const PHASE_HINT = {
  interviewing: (answers) => answers < 2
    ? "再聊一轮就能整理共识。"
    : "不设固定题数——觉得说清楚了就整理。",
  summary: () => "核对这份共识：不对就在下面补一句。",
  drafting: () => "写完自动进编辑器。",
};

const STARTERS = [
  { label: "从一件事说起", text: "最近有件事让我反复在想……" },
  { label: "从一个判断说起", text: "我有个判断，但还不知道怎么说清楚……" },
  { label: "从一个困惑说起", text: "有个问题我一直没想明白……" },
];

/**
 * 访谈是**一栏的对话**，不是「聊天 + 简报」两栏。
 *
 * 上一版右边挂了一条 270px 的 LIVE BRIEF：平台、暂定主题、三步进度、一句说明、一颗按钮。
 * 问题不在这五样东西本身，在于**它们加起来撑不满那一栏**——开场时主题是空的、
 * 进度是 1/3、按钮是灰的，于是那栏中间挖出三百多像素谁也不属于的空白，
 * 而左边的对话区被压成 780px 宽。五样东西各自都有更该待的地方：
 *
 * - **平台** → 眉标行（这一屏唯一的设置项，不值一栏）
 * - **暂定主题** → **删掉**。这一屏开口第一句就是「不用先想标题」，
 *   却在右边摆一个写着「可以最后再写」的输入框，等于要求用户处理一件我们刚说过不用处理的事。
 *   访谈结束进编辑器时标题由正文推出来（`deriveDraftTitle`），编辑器顶上本来就有标题框。
 * - **进度 + 说明 + 动作** → 压成输入框正上方的一行。它们说的是同一件事
 *  （现在到哪儿了 / 该做什么 / 按哪儿），本来就该挨着；**尤其是那句说明和那颗按钮**——
 *   它解释的正是按钮此刻为什么按不了。
 *
 * 换来的是对话流吃满宽度、限在 720px 的可读列里居中，且**开场不撑高**。
 */
function Interview({ messages, message, setMessage, phase, busy, answers, onSend, onSummarize, onConfirm }) {
  // 有真话说出口了才画进度行。一句都没说时它三格全灰，是一张贴纸
  const started = messages.some((item) => !item.control);
  const logRef = useRef(null);
  /**
   * 新消息要**自己滚到眼前**。没有这一段的话，聊到第四五轮之后助手的追问就落在
   * 折叠线以下——屏幕上看着像「发出去了但它没回」，而人不会想到要往下滚。
   *
   * ⚠️ **但用户自己往上翻的时候不能把他拽回来。** 所以跟不跟随由「翻之前是不是贴着底」
   * 决定（`stick`），而不是每次有新内容就无条件滚——回头看前面说过什么，正是访谈里
   * 常做的事。判据记在滚动事件里，因为**追加内容本身不触发 scroll 事件**，
   * 那一刻的 `stick` 还是用户最后一次滚动时的状态，正是要的。
   */
  const stick = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  /**
   * 输入框**跟着字长高**，一行起步。
   *
   * 收进盒子之后它不能再挂 `resize: vertical`（那个手柄会戳穿盒子的圆角），
   * 而写死三行高的话，空态就是一个占了三行、只用了一行的框。
   * 上限 168px 之后自己滚——再高就把对话挤没了。
   *
   * ⚠️ **先归零再量 `scrollHeight`**：不归零的话它只增不减，删字之后框不会缩回去。
   */
  const inputRef = useRef(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [message]);
  return (
    <div className="creation-interview">
      <div
        className="creation-chat__log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {/* ⚠️ **限宽的可读列是这一层（`__stream`），不是滚动容器本身。**
            限在容器上的话，气泡的 `align-self: flex-end` 会贴到窗口右缘去；
            而它的右内边距要**把发送键那一列也算进去**，这样列的右边界和输入框的右边界重合，
            居中的欢迎区就和输入框同轴——这条对齐上一版栽过两次，见 CSS 里的长注释。 */}
        <div className="creation-chat__stream">
          {!messages.length ? (
            /**
             * 空态**贴着输入框放，不悬在正中间**：这一屏唯一要做的事是「开口说第一句」，
             * 而说话的地方在最下面。悬在正中的那一版把说明和输入框拉开了半屏，
             * 中间那块空白不属于任何东西（`.creation-chat__log` 的 `justify-content` 管这件事）。
             */
            <div className="creation-interview-welcome">
              <span><IconMessageQuestion aria-hidden="true" stroke={1.7} /></span>
              <h3>不用先想标题，我们直接聊</h3>
              <p>写下一段经历、一个困惑，或刚冒出来的判断——助手一次只追问一个最值得展开的问题。</p>
              {/* 起手句直接填进输入框，不代发：**第一句必须是你自己的话**，
                  替你发出去的话，后面几轮追问就都建立在一句模板上了 */}
              <div>
                {STARTERS.map((one) => (
                  <button key={one.label} onClick={() => setMessage(one.text)}>{one.label}</button>
                ))}
              </div>
            </div>
          ) : messages.map((item, index) => item.control ? null : (
            // ⚠️ 消息行的样式挂在 `.creation-msg` 上，**不是挂在 `.creation-chat__stream > div` 上**。
            // 按位置写的话，同在这个容器里的欢迎区会被当成一条消息：它的第一个 `<span>`
            // （那枚圆形图标）会被涂成灰色小标签，`<p>` 会被套上聊天气泡的灰底。
            <div key={`${item.role}-${index}`} className="creation-msg" data-role={item.role}>
              <span>{item.role === "user" ? "你" : "访谈助手"}</span>
              <p>{item.text || (busy ? "正在整理…" : "")}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="creation-chat__foot">
        {/* 进度 · 该做什么 · 动作，压在输入框正上方的一行里。
            ⚠️ **那句说明必须紧挨着那颗按钮**：它解释的正是「按钮此刻为什么按不了」。
            上一版把它们隔在右栏的两头（实测中间空了 335px），解释和被解释的东西不在一起。 */}
        {started ? (
          <div className="creation-phase">
            {/* 步骤条上挂**真实进度**（答了几轮），不是三个静态的字 */}
            <ol className="creation-phase__steps">
              <li data-on="true">梳理想法{answers ? <em>{answers} 轮</em> : null}</li>
              <li data-on={phase === "summary" || phase === "drafting"}>确认共识</li>
              <li data-on={phase === "drafting"}>生成初稿</li>
            </ol>
            <p className="creation-phase__now">{(PHASE_HINT[phase] || PHASE_HINT.interviewing)(answers)}</p>
            {/* 起稿跑起来之后按钮**照实说它在干什么**，不是显示一颗按不动的「整理共识」——
                那会让人以为自己刚才那一下没点上 */}
            {phase === "drafting" ? (
              <button className="btn" disabled><IconLoader2 className="spin" aria-hidden="true" />生成初稿中</button>
            ) : phase === "summary" ? (
              <button className="btn btn-primary" onClick={onConfirm} disabled={busy}><IconCheck aria-hidden="true" />确认起稿</button>
            ) : (
              <button className="btn" onClick={onSummarize} disabled={busy || answers < 2}
                title={answers < 2 ? "再聊一轮，助手才有足够的话可整理" : "把这几轮聊出来的东西整理成共识"}>
                <IconNotebook aria-hidden="true" />整理共识
              </button>
            )}
          </div>
        ) : null}
        {/**
          * ⚠️ **输入区是一个盒子，发送键在盒子里面。**
          *
          * 上一版把发送键摆在输入框**旁边**——一个 42px 的方块贴着一个 76px 的框，
          * 两个尺寸不一样的东西并排，看着就是拼上去的；而且它还逼着聊天区的右内边距
          * 跟着让出一列（那正是这一屏栽过两次的对齐坑）。**收进框里之后那个坑不存在了**：
          * 输入区和上面的对话共用同一条可读列，两边都是 720，不用再算差值。
          *
          * 键盘规矩顺势有了自己的位置（底行左端），不再压在右下角和发送键抢地方。
          */}
        <div className="creation-chat__composer">
          {/* ⚠️ `rows={1}` 不能省：textarea 的 HTML 默认是 **2 行**，而自动增高量的是
              `height:auto` 下的 `scrollHeight`——默认值会让空框凭空高出一行（实测 47px 而不是 26px），
              看着就是「一个占了两行、只用了一行的框」。 */}
          <textarea ref={inputRef} rows={1} data-autofocus="" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={messages.length ? "回答这个问题，或补充你刚想到的内容" : "先随便说说，不用整理……"} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} />
          <div className="creation-composer__bar">
            <small>Enter 发送 · Shift + Enter 换行</small>
            <button className="btn btn-primary creation-composer__send" onClick={onSend} disabled={busy || !message.trim()} aria-label="发送"><IconSend aria-hidden="true" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
