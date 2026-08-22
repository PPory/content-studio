// 每日清单：取数（`usePlan`）+ 那一块界面（`DayPlan`）+ 完成进度环。
//
// ⚠️ **从 `pages/Overview.jsx` 搬到这儿来的，函数体一字未动。**
// 搬家的理由不是「文件太长」，是**依赖方向反了**：`Today.jsx` 原来直接
// `import { DayPlan, usePlan } from "./Overview.jsx"` —— **页面 import 另一个页面**，
// 而 CLAUDE.md 里明写着不许。后果不是马上坏，是「改总览会顺手改坏今日」，
// 而那种坏法没有任何地方会报出来。两个页面都要的东西，位置就该在 `components/`。
//
// ⚠️ **注释跟着代码一起搬**：这些注释大半记的是踩过的坑（乐观锁放 ref 不放闭包、
// 追加不带 stamp、日期串由服务端给），丢一条比多两百行贵。

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, Note, SectionHead } from "./ui.jsx";
import { IconCheck, IconClipboardList, IconPlus, IconTrash } from "./icons.jsx";

// 工作台在 vault 里的那一级。**这一段在每一条路径里都一模一样**，显示时要掐掉——
// 和「信源芯片上不写『已刷新』」是同一条：每个都说的话等于没说，
// 而它占的是这一行里最值钱的开头 8 个字。
//
// ⚠️ **不和 `ReaderOverlay` 的 `docPath()` 合并**：那个是「从一条 item 里挑出路径再裁」，
// 签名和职责都不同；而且它那儿的注释明写着「写死字面量是有意的，
// 不该因为 import 了常量就跟着布局变量走」。合并只会把两件事绑在一起。
// 跟着 `DayPlan` 一起从 `Overview.jsx` 搬过来的，那边现在没人用了，已删。
const WB_PREFIX = "99 - 个人工作台/";
function shortPath(path) {
  const p = String(path || "");
  return p.startsWith(WB_PREFIX) ? p.slice(WB_PREFIX.length) : p;
}

/**
 * 每日计划的取数与改写。
 *
 * **清单落 vault 的 `05 - 计划/<日期>.md`，不落 localStorage**：手写的任务是你自己的字，
 * 是内容，而红线写着「不用 localStorage 存内容」。落 vault 换来的是——打钩就是把
 * `- [ ]` 改成 `- [x]`（Obsidian 原生就认，两边是同一份），躺床上用手机在 Obsidian 里
 * 列明天的清单，第二天早上工作台里就有它。
 *
 * **「今天 / 明天」两个日期串由服务端给**（`today` / `tomorrow`），前端不自己 `new Date()`：
 * 文件名是按**服务端本机日期**建的，两边各算各的话，跨零点或时区一错就会写进另一个文件，
 * 而现象是「我明明列过的清单不见了」。
 */
export function usePlan(enabled) {
  const [date, setDate] = useState("");
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ loading: true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // 改写要带上「打开时那一刻的 stamp」，而它每次动作后都会变。放 ref 不放闭包：
  // 从 state 里捞的话，连点两下会拿同一个旧 stamp 打第二次，第二下必然 409。
  const ref = useRef(null);

  const apply = useCallback((data) => {
    ref.current = data;
    setState({ loading: false, data });
    setError(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api
      .plan(date)
      .then((d) => alive && apply(d))
      .catch((e) => alive && setState({ loading: false, failed: e }));
    return () => {
      alive = false;
    };
  }, [enabled, date, tick, apply]);

  /**
   * 每个动作都**拿服务端回的那份新状态整个覆盖**，不在前端拼一份「应该长这样」。
   * 这个文件同时可能在 Obsidian 里开着，只有服务端刚读到的那份才作数——
   * 前端自己改一个字段的话，界面和文件会安静地分叉。
   */
  const run = useCallback(
    async (call) => {
      const now = ref.current;
      if (!now) return;
      setBusy(true);
      try {
        apply(await call(now));
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
    [apply]
  );

  return {
    enabled: !!enabled,
    ...state,
    error,
    busy,
    setDate,
    reload: () => setTick((t) => t + 1),
    add: (text) => run((p) => api.addTask(p.date, text)),
    toggle: (index, done) => run((p) => api.toggleTask(p.date, p.stamp, index, done)),
    remove: (index) => run((p) => api.removeTask(p.date, p.stamp, index)),
  };
}

/**
 * 完成进度环。**分母是清单里的条数，不是推算出来的**——这也是它能存在的全部理由：
 * 目标由你自己写下，环只是把「几条里完成了几条」画出来，不用编任何数字。
 *
 * **一条任务都没有时照画**（空环 + `0/0`）。上一版在空清单时把它整个藏起来，理由是
 * 「空环是装饰」——那个理由站不住：清单空着恰恰是最常见的初始状态，藏起来的结果是
 * **这个环从来没被看见过**。而且它一出现整块就会往下跳一次。
 */
function ProgressRing({ done, total }) {
  const r = 53;
  const circumference = 2 * Math.PI * r;
  const ratio = total ? done / total : 0;
  const left = total - done;
  // 环底下那句话按状态换。**「还剩 2 条」和「今天清空了」不能说同一句**——
  // 一个是「继续」，一个是「可以收工了」。（`total === 0` 时整个环不画，见调用处）
  const note = left ? `还剩 ${left} 条` : "今天清空了";

  return (
    <div className="plan-ring" role="img" aria-label={`${total} 条任务里完成了 ${done} 条`}>
      {/* 定位容器是里面这层 `__dial`，不是整个 `.plan-ring`——底下那行说明要正常排在环下面，
          挂在同一个 `position: relative` 上会被绝对定位的数字压住 */}
      <div className="plan-ring__dial">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="plan-ring__track" cx="60" cy="60" r={r} />
          <circle
            className="plan-ring__arc"
            cx="60"
            cy="60"
            r={r}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        </svg>
        {/* 两截包在**一个**行内块里，让浏览器按正常行内流去排。直接把 `{done}` 和 `<i>` 摊在
            定位容器里的话，它们会变成两个独立的盒子（grid 里上下摞、flex + baseline 里整行顶到上边），
            图上一眼就看得出，而冒烟测试照样绿。 */}
        <span className="plan-ring__label" aria-hidden="true">
          <span>
            {done}
            <i>/{total}</i>
          </span>
        </span>
      </div>
      <span className="plan-ring__note">{note}</span>
    </div>
  );
}

/**
 * 手写的任务清单。首页的主位就是它。
 *
 * **vault 没配时整块不画**（不是画一个报错的空壳）：底下的系统行已经在说这件事，
 * 而且那儿的引导是能点的。同一个问题在一屏上说两遍，第二遍就是噪音。
 */
export function DayPlan({ plan }) {
  const [text, setText] = useState("");
  // 输入框**默认不在**，点「+」才展开。常驻的话，空清单那一屏就是「一句说明 + 一个空
  // 输入框 + 一行路径」三样东西在说同一件事，而它们加起来比清单本身还高。
  const [adding, setAdding] = useState(false);
  const data = plan.data;
  const tasks = data?.tasks || [];
  const done = tasks.filter((t) => t.done).length;
  // 「今天还是明天」由服务端给的两个日期串比出来，不在前端算日期
  const isTomorrow = !!data && data.date === data.tomorrow;
  const dayLabel = isTomorrow ? "明天" : "今天";

  if (!plan.enabled) return null;

  function submit(e) {
    e.preventDefault();
    if (!text.trim() || plan.busy) return;
    plan.add(text);
    setText("");
  }

  return (
    <section className="day-plan overview-block">
      <SectionHead icon={IconClipboardList} title="我的清单" />

      {/* 左边清单、右边大环。**环不放页头的 aside 里**：那儿只有一行的高度，塞进去就只能是
          一枚小徽章，而这一块要一眼看出「今天走到哪了」——那正是大环存在的理由。
          右栏定宽：左边是长短不一的中文任务，按比例分的话环会跟着任务文字长短忽大忽小。 */}
      <div className="plan-body">
        <div className="plan-main">
          {/* 今天 / 明天两档。**这一档必须有**：用户的动线是「今晚列明天的」，
              只给今天的话，这个清单最主要的写入时机压根没有入口。 */}
          <div className="plan-days">
            {data ? (
              <>
                <button className="plan-day" data-on={!isTomorrow} onClick={() => plan.setDate(data.today)}>
                  今天
                </button>
                <button className="plan-day" data-on={isTomorrow} onClick={() => plan.setDate(data.tomorrow)}>
                  明天
                </button>
                <button
                  className="plan-plus"
                  title={`加一条到${dayLabel}的清单`}
                  aria-label={`加一条到${dayLabel}的清单`}
                  aria-expanded={adding}
                  onClick={() => setAdding((v) => !v)}
                >
                  <IconPlus size={16} stroke={2.2} aria-hidden="true" />
                </button>
                {/* **如实说明这份清单存到哪了**（和批注那条「保存前就该知道东西落在哪」同一条），
                    但不再单独占一行——挂在这一排的最右端。显示路径掐掉 `99 - 个人工作台/`：
                    那一段在每份文档上都一样，占的是最值钱的开头几个字。 */}
                <span className="plan-where mono" title={data.path}>
                  {shortPath(data.path)}
                </span>
              </>
            ) : null}
          </div>

      {/* 改写失败（多半是 409：文件刚在 Obsidian 里被动过）单独报，**不能把已经读到的
          清单顶掉**——报个错就把列表清空的话，用户会以为清单本身也没了。
          「刷新一下再试」这句话本身要能点，否则它就是个死胡同。 */}
      {plan.error ? (
        <Note tone="danger" title={`改这份清单失败：${plan.error.message}`}>
          {plan.error.hint || "回终端看 npm run dev 的日志"}
          <button className="sysrow__btn" style={{ marginTop: 8 }} onClick={plan.reload}>
            重新读一遍
          </button>
        </Note>
      ) : null}

      {plan.loading && !data ? (
        <Loading rows={2} />
      ) : plan.failed ? (
        <ErrorNote error={plan.failed} what="读今天的计划" />
      ) : (
        <>
          {tasks.length ? (
            <ul className="plan-list">
              {tasks.map((t) => (
                <li key={`${t.index}:${t.text}`} className="plan-task" data-done={t.done}>
                  {/* 整行可点，不是只有那个小方框——12px 的点击目标在一个每天要点好几次的
                      控件上太苛刻了。删除按钮是**另一个** button，所以行本身不能是 button。 */}
                  <button
                    className="plan-task__main"
                    aria-pressed={t.done}
                    disabled={plan.busy}
                    onClick={() => plan.toggle(t.index, !t.done)}
                  >
                    <span className="plan-task__box" aria-hidden="true">
                      {t.done ? <IconCheck size={13} stroke={2.6} /> : null}
                    </span>
                    <span className="plan-task__text">{t.text}</span>
                  </button>
                  {/* 只在 hover / 聚焦时出现：删一条不给二次确认（一行字点两下太重），
                      靠「平时不在那儿」来防误触，和书架卡片上的换封面按钮同一条。 */}
                  <button
                    className="plan-task__del"
                    disabled={plan.busy}
                    title="从清单里删掉这条"
                    aria-label={`从清单里删掉「${t.text}」`}
                    onClick={() => plan.remove(t.index)}
                  >
                    <IconTrash size={14} stroke={1.7} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            /**
             * ⚠️ **一条都没有时说一句下一步，不能整块空着。**
             * 上一版这儿是 `null`：屏幕上「今天 / 明天 / ＋」那一排底下直接是一片空白，
             * 而这块的标题还写着「我的清单」——看着像**没加载出来**，不像「还没列」。
             * 空态说的是**下一步**（去点那个 ＋），不是「暂无数据」；
             * 而且要说清这份清单**落在哪**（Obsidian 里同一份文件，手机上也能列）。
             */
            !adding ? (
              <button className="plan-empty" onClick={() => setAdding(true)}>
                <IconPlus size={15} stroke={1.9} aria-hidden="true" />
                <span>
                  <b>{dayLabel}还没列清单</b>
                  <em>点这儿加一条。它就是 Obsidian 里那份 Markdown，手机上列也一样。</em>
                </span>
              </button>
            ) : null
          )}

          {/* 输入框只在点过「+」之后出现，而且**加完一条不收起**——晚上列明天的清单是
              一口气写五六条，每条都要重新点一次「+」的话，这个入口就成了收费站。
              Esc / 空着失焦才收起。 */}
          {adding ? (
            <form className="plan-add" onSubmit={submit}>
              <input
                value={text}
                autoFocus
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  // 这一层自己吃掉 Esc：不拦的话它会一路冒到别处去
                  e.stopPropagation();
                  setText("");
                  setAdding(false);
                }}
                onBlur={() => !text.trim() && setAdding(false)}
                placeholder={`加一条到${dayLabel}…`}
                maxLength={200}
                aria-label={`加一条任务到${dayLabel}的清单`}
              />
              <button type="submit" disabled={!text.trim() || plan.busy}>
                加一条
              </button>
            </form>
          ) : null}

          {data?.unknownMarks ? (
            <p className="plan-foot">
              这份文件里还有 {data.unknownMarks} 行工作台认不出的任务标记（比如 <code>[/]</code>），它们原样留在文件里。
            </p>
          ) : null}
        </>
      )}
        </div>

        {/* **一条任务都没有时不画环。** 这和「空清单时也要画」正好相反，是看过实物之后改的：
            画出来的是一个满圈的灰环加 `0/0`，它既不报告进度、也不指引下一步，只是把
            「你还没开始」这件事放大成这一屏最大的图形。环有值可报时才出现。 */}
        {tasks.length ? (
          <div className="plan-side">
            <ProgressRing done={done} total={tasks.length} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
