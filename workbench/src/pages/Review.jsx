// 收成：发出去之后，一篇一篇留下判断。
//
// ⚠️ **这一页原来永远是 0，而那不是 bug，是它只认了一半的东西。**
// 它只列走过流水线的项目（`stage === 待复盘`），可你真正发出去的内容是从平台后台
// 导进来的——那些内容在 `posts.csv` 里，工作台压根不知道是谁写的（`doc` 列空着）。
// 于是「已发布 3 篇」和「0 篇等待复盘」同时挂在屏幕上，而没有任何地方解释这件事。
// 现在两边都列：项目那一档照旧，另加一档**「发出去了，但工作台里没有对应的稿子」**。
//
// ⚠️ **页头用 `FilterHeader` 不用 `PageHeader`。** 这一页打开时你要先选看哪一档
// （待复盘 / 已完成 / 没对上的），**那排芯片才是第一件事**，说明是它的注脚；
// 而 `PageHeader` 是「左边一句说明、右边一颗按钮」，中间空一大片——
// 那是给内容已经在那儿的页面用的。

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, FilterHeader, ViewTabs, Empty } from "../components/ui.jsx";
import { PositioningNote } from "../components/PositioningNote.jsx";
import { platformColor } from "../components/TrendChart.jsx";
import { fmtNum, metricLabel, METRIC_KEYS } from "../lib/posts.js";
import { IconArrowRight, IconCheck, IconChartBar, IconLink } from "../components/icons.jsx";

/** 三档的真源。⚠️ `key` 决定选中哪一档，顺序就是屏幕上的顺序。 */
const LANES = [
  { key: "待复盘", label: "待复盘" },
  { key: "没对上", label: "没对上稿子" },
  { key: "已完成", label: "已完成" },
];

function useDark() {
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return undefined;
    const on = (e) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

export function Review({ onGo }) {
  const [result, setResult] = useState(null);
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [lane, setLane] = useState("待复盘");
  const dark = useDark();

  const load = useCallback(() => {
    setError(null);
    api.projects().then(setResult).catch(setError);
    // ⚠️ 读不到 posts 不能让整页失败：项目那两档和它无关，
    // 而「平台数据还没导」本来就是常态。
    api.posts().then(setPosts).catch(() => setPosts({ rows: [] }));
  }, []);
  useEffect(load, [load]);

  const projects = result?.projects || [];
  const pending = useMemo(() => projects.filter((p) => p.stage === "待复盘"), [projects]);
  const completed = useMemo(() => projects.filter((p) => p.stage === "已完成"), [projects]);

  /**
   * 发出去了、但工作台里没有对应稿子的那些。
   *
   * ⚠️ **判据是 `doc` 列空着，不是「标题匹配不上」。** `doc` 是**人手动指认过**
   * 「这条对应哪篇稿子」的结果，平台导出文件里根本没有这个信息。
   * 靠标题去猜的话，同一篇内容在两个平台标题常常不一样（实测「推荐一个公众号排版
   * 工具」和「推荐一个自己做的公众号排版工具」），猜错了还会**安静地**把两篇并成一篇。
   */
  const loose = useMemo(
    () => (posts?.rows || []).filter((r) => !String(r.doc || "").trim()).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [posts]
  );

  const counts = { 待复盘: pending.length, 没对上: loose.length, 已完成: completed.length };
  const shown = lane === "待复盘" ? pending : lane === "已完成" ? completed : loose;

  return (
    <>
      <FilterHeader
        title="复盘"
        desc="一篇一篇地留下判断和下一步，数字只是依据，不是结论。"
        chips={
          <ViewTabs
            items={LANES.map((l) => ({ key: l.key, label: l.label, count: counts[l.key] ?? 0 }))}
            value={lane}
            onChange={setLane}
            label="按状态筛选"
          />
        }
      />

      {/*
        涌现定位长在复盘页：复盘回答的就是「发出去之后我学到了什么」，
        而定位正是这些学到的东西攒够之后才看得出来的形状。
        它不新开页面，也不要求填任何字段。
      */}
      <PositioningNote />

      <ErrorNote error={error} what="读取复盘任务" />
      {!result && !posts && !error ? <Loading rows={4} /> : null}

      {/* ⚠️ **每一档各自失败，不能一起垮。** 「没对上稿子」读的是本地的 posts.csv，
          跟 Worker 一点关系都没有——整块挂在 `result` 上的话，流水线连不上时
          这一档也跟着消失，而它恰恰是此刻唯一还有内容的那一档。 */}
      {result || posts ? (
        <div className="review-home">
          {lane === "没对上" ? (
            loose.length ? (
              <>
                {/* ⚠️ 照实说清这一档是什么，否则它看着像「复盘漏了几篇」。
                    它们不是漏了，是工作台从来不知道它们和哪篇稿子是同一件事。 */}
                <p className="review-note">
                  这几篇是从平台后台导进来的，工作台里没有对应的稿子——所以复盘时只有数字，
                  没有「当初想说什么」。在项目页把稿子和它对上之后，两边就能放在一起看了。
                </p>
                <div className="loose-list">
                  {loose.map((r, i) => (
                    <article key={`${r.platform}-${r.date}-${i}`} className="loose">
                      <div className="loose__head">
                        <span className="tag tag--state">
                          <span className="dot" style={{ background: platformColor(r.platform, dark) }} />
                          {r.platform}
                        </span>
                        <span className="loose__date">{r.date}</span>
                      </div>
                      <h3>{r.title || "（无标题）"}</h3>
                      <div className="loose__metrics">
                        {METRIC_KEYS.filter((k) => r[k] != null).map((k) => (
                          <span key={k}>
                            {metricLabel(r.platform, k)} <strong>{fmtNum(r[k])}</strong>
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <Empty icon={IconLink}>每一篇发出去的内容都对上稿子了。</Empty>
            )
          ) : shown.length ? (
            <div className="review-list">
              {shown.map((project, i) => (
                <ReviewCard
                  key={project.id}
                  project={project}
                  index={i}
                  compact={lane === "已完成"}
                  onOpen={() => onGo("project", project.id)}
                />
              ))}
            </div>
          ) : !result ? (
            <Loading rows={3} />
          ) : lane === "待复盘" ? (
            <div className="review-empty">
              <IconCheck aria-hidden="true" />
              <h3>没有积压的复盘</h3>
              {/* ⚠️ **空态要说清「为什么是空的」。** 上一版写「新内容记录发布后会自动出现」，
                  而屏幕上同时有 3 篇已发布的内容——那句话当场就是假的。 */}
              <p>
                走过工作台的稿子记录发布后会出现在这里。
                {loose.length ? `另有 ${loose.length} 篇是从平台导进来的，在「没对上稿子」那一档。` : ""}
              </p>
              {loose.length ? (
                <button type="button" className="btn btn-sm" onClick={() => setLane("没对上")}>
                  去看那 {loose.length} 篇
                  <IconArrowRight aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : (
            <Empty icon={IconChartBar}>还没有留下过复盘判断。</Empty>
          )}
        </div>
      ) : null}
    </>
  );
}

function ReviewCard({ project, index, onOpen, compact = false }) {
  const record = project.publication?.latest;
  return (
    <article className="review-card" data-compact={compact || undefined}>
      <span className="review-card__index">{String(index + 1).padStart(2, "0")}</span>
      <div className="review-card__main">
        <div>
          <span>{record?.platform || project.brief?.platform || "未知平台"}</span>
          <small>{record?.publishedAt ? new Date(record.publishedAt).toLocaleDateString("zh-CN") : "已发布"}</small>
        </div>
        <h3>{project.title}</h3>
        <p>{compact ? project.review?.nextExperiment : project.stageReason}</p>
      </div>
      <div className="review-card__action">
        <span>{compact ? "下一步已留存" : project.nextAction}</span>
        <button className="btn btn-primary btn-sm" onClick={onOpen}>
          {compact ? "查看" : "开始复盘"}
          <IconArrowRight aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
