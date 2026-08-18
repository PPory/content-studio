// 洞察跑批：页头那个按钮 + 页面上的进度条。
//
// ## 为什么按钮不是「点了就跑」这么简单
//
// 跑一次洞察最大的摩擦不是敲那条命令，是「我不知道现在能不能跑」——
// 材料抓了没、上周挂了什么账、这周报告是不是已经有了。以前要翻三个目录才能确认。
// 所以点开先给状态，再让你按第二下。**这一下不是走流程，是让你看见它要花什么**：
// 缺材料的周次会先抓一次（约 270 credits），材料齐的周次一分钱不花——
// 而这两种情况在按钮上看起来是一样的，不说清楚就成了盲点。
//
// ## 进度条为什么可信
//
// 它不是按时间匀速走的。服务端盯着 skill 的工件依次落盘
//（manifest → evidence-ledger → candidate-registry → … → 报告）来算百分比。
// **卡住的时候它就是不动的**——那正是你需要知道的信息，一个还在爬的假进度条会把它盖掉。
//
// ## 为什么拆成 hook + 两个哑组件
//
// 按钮要待在页头的 `aside` 里（窄），进度条要在正文顶部铺满（宽）。
// 两个位置隔着一整个 PageHeader，但共享同一份轮询状态——**各自再轮询一次会互相打架**，
// 显示的百分比还可能差一拍。所以状态归 hook，位置归调用方。

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { IconRadar2, IconX } from "./icons.jsx";

const SOURCE_CN = { reddit: "Reddit", x: "X", aihot: "AI 日报" };

/** 轮询跑批状态。`onDone` 只在「由跑着变成跑完」的那一刻触发一次。 */
export function useInsightRun(onDone) {
  const [run, setRun] = useState(null);
  const timer = useRef(null);
  // 记住上一次是不是在跑：每次轮询都调 onDone 的话，
  // 报告列表会被反复重挂，正在读的那张卡会闪。
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    try {
      const r = await api.insightRunStatus();
      setRun(r.run);
      if (r.run?.status === "running") wasRunning.current = true;
      else if (wasRunning.current) {
        wasRunning.current = false;
        if (r.run?.status === "done") onDone?.();
      }
    } catch {
      /* 轮询失败不弹错：dev server 重启的一瞬间必然失败几次，弹出来纯属噪音 */
    }
  }, [onDone]);

  // 进页面就开始轮询：跑批可能是上次会话留下的，**打开就该看见它还在跑**。
  useEffect(() => {
    poll();
    timer.current = setInterval(poll, 3000);
    return () => clearInterval(timer.current);
  }, [poll]);

  const markStarted = useCallback((r) => {
    setRun(r);
    wasRunning.current = true;
  }, []);

  const cancel = useCallback(async () => {
    const r = await api.insightRunCancel();
    setRun(r.run);
  }, []);

  return { run, markStarted, cancel, refresh: poll };
}

/** 页头那颗按钮 + 点开后的就绪面板。 */
export function InsightRunButton({ run, onStarted }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const running = run?.status === "running";

  const openPanel = async () => {
    setOpen(true);
    setErr("");
    setReady(null);
    try {
      setReady(await api.insightReady());
    } catch (e) {
      setErr(e.hint ? `${e.message}——${e.hint}` : e.message);
    }
  };

  const start = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api.insightRunStart(ready?.week || "");
      onStarted?.(r.run);
      setOpen(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn btn-primary"
        onClick={running ? undefined : openPanel}
        disabled={running}
        title={running ? "正在跑，进度见下方" : "跑一次洞察"}
      >
        <IconRadar2 aria-hidden="true" stroke={2} />
        {running ? `跑洞察中 ${run.percent}%` : "跑一次洞察"}
      </button>

      {open ? (
        <div className="run-panel" role="dialog" aria-label="跑一次洞察">
          <div className="run-panel__head">
            <b>跑一次洞察</b>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="关闭">
              <IconX aria-hidden="true" stroke={2} />
            </button>
          </div>

          {err ? <p className="run-panel__err">{err}</p> : null}
          {!ready && !err ? <p className="page-sub">正在看这一周的状态…</p> : null}

          {ready ? (
            <>
              <p className="run-panel__week">
                本周 <b>{ready.week}</b>
                {ready.reportExists ? (
                  <span className="run-panel__warn">　·　已有报告，跑完会覆盖正文（批注不受影响）</span>
                ) : null}
              </p>

              <ul className="run-panel__list">
                {ready.materials.map((m) => (
                  <li key={m.source} className={m.bytes ? "is-ok" : "is-missing"}>
                    {m.bytes ? "✓" : "✗"} {SOURCE_CN[m.source] || m.source}
                    <span className="run-panel__dim">
                      {m.bytes ? ` ${Math.round(m.bytes / 1024)} KB` : " 未抓取"}
                    </span>
                  </li>
                ))}
              </ul>

              {ready.willFetch ? (
                <p className="run-panel__cost">
                  ⚠️ 缺 {ready.missing.map((s) => SOURCE_CN[s] || s).join(" / ")}，会先抓一次，
                  <b>约 270 credits</b>（Bright Data）。材料齐的周次点这里不花钱。
                </p>
              ) : (
                <p className="page-sub">材料齐全，本次不抓取。联网核实仍会用到 Brave / Firecrawl。</p>
              )}

              {/* 说「上周」是错的：挂账是扫所有周次收上来的，隔了几周没跑的也在里面。
                  所以标周次，别用相对时间词。 */}
              {ready.pending?.length ? (
                <div className="run-panel__pending">
                  <b>还有 {ready.pending.length} 条挂账没结：</b>
                  <ul>
                    {/* 周次只在**和本周不同**时才显示：那时它才带信息（这条挂了几周了）。
                        同周显示等于把「2026-W33」在同一行里印两遍。 */}
                    {ready.pending.map((p) => (
                      <li key={p.id}>
                        <code>{p.id}</code>
                        {p.from_week && p.from_week !== ready.week ? (
                          <span className="run-panel__dim"> {p.from_week} 起</span>
                        ) : null}{" "}
                        {p.action}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="run-panel__actions">
                <button className="btn btn-primary" onClick={start} disabled={busy}>
                  {busy ? "正在启动…" : ready.willFetch ? "抓取并开始分析" : "开始分析"}
                </button>
                <button className="btn" onClick={() => setOpen(false)}>
                  先不跑
                </button>
              </div>

              <p className="run-panel__note">
                后台跑，几十分钟量级。<b>关掉面板、关掉浏览器都不影响它</b>，回来在这一页看进度。
                要人扫码的站内深取不在自动流程里，需要的话它会记成一条挂账。
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** 正文顶部的进度条。跑完和失败都留着——**失败原因比进度重要，不能一结束就消失**。 */
export function InsightRunProgress({ run, onCancel }) {
  if (!run || !run.status) return null;
  const running = run.status === "running";
  const failed = run.status === "failed";
  return (
    <div className={`run-progress is-${run.status}`}>
      <div className="run-progress__top">
        <span className="run-progress__stage">
          {running ? run.stageLabel : failed ? "跑批失败" : "已完成"}
          <span className="run-progress__dim">　{run.week}</span>
        </span>
        <span className="run-progress__pct">{run.percent}%</span>
        {running ? (
          <button className="btn btn-sm" onClick={onCancel}>
            中止
          </button>
        ) : null}
      </div>
      <div className="run-progress__bar">
        <span style={{ width: `${run.percent}%` }} />
      </div>
      {failed && run.error ? <p className="run-progress__err">{run.error}</p> : null}
      {running ? (
        <p className="run-progress__note">
          进度按工件落盘算，不按时间走——<b>不动就是真的卡在那一步</b>，完整日志在{" "}
          <code>tmp/insight-run.log</code>
        </p>
      ) : null}
    </div>
  );
}
