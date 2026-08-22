// 首屏那一排数字：**产出 · 待办 · 库存 · 反馈**，四条不同的链各一条。
//
// ⚠️ **四个数不能都取自同一条链。** 试过全用流水线计数（待初筛 / 待整理 / 选题待写 /
// 写作中），那四个数**平时全是 0**——流水线自己会消化它们，0 才是正常态。
// 首屏最大的四个数字大多数时候在展示「没事」，那是把最贵的位置给了信息量最低的东西。
//
// 现在四条各管一段：**我产出了多少**（posts.csv）、**多少事等我**（内容项目）、
// **手里有多少料**（素材工作区）、**跟着涨了多少粉**（metrics.csv）。
//
// ⚠️ **每个数都要带上让它有意义的那个参照**（`delta` / `note`）。
// 一个孤零零的「8」回答不了「这算多还是少」，而那正是看一眼首屏想知道的事。

import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { StatCard } from "../../components/ui.jsx";
import { fmtNum, monthOf, overview, platformSummary, inMonth } from "../../lib/posts.js";
import { IconArchive, IconChartBar, IconSend, IconUsers } from "../../components/icons.jsx";

/**
 * 最新一周的粉丝总数，以及和上一周的差。
 *
 * ⚠️ **按「每个平台各自最后一条」求和，不是「最后一天所有行」求和。**
 * 各平台的录入节奏不同（小红书每周、公众号隔周），取最后一天的话，
 * 那天没录的平台会**整个从总数里消失**——粉丝数会凭空掉几千，而没有任何地方会报错。
 */
export function followerTotal(rows = []) {
  const latest = new Map();
  const prev = new Map();
  for (const r of [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    if (r.followers == null) continue;
    if (latest.has(r.platform)) prev.set(r.platform, latest.get(r.platform));
    latest.set(r.platform, r.followers);
  }
  const now = [...latest.values()].reduce((a, b) => a + b, 0);
  // 只有当**每个**平台都有上一条时，环比才是可比的；否则不给这个数，别编
  const comparable = latest.size > 0 && [...latest.keys()].every((p) => prev.has(p));
  const before = comparable ? [...prev.values()].reduce((a, b) => a + b, 0) : null;
  return { now, delta: before == null ? null : now - before, platforms: latest.size };
}

export function TodayStats({ pending, topStage, onGo }) {
  const [posts, setPosts] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [mats, setMats] = useState(null);

  // 三条各自取数、各自失败：任何一条挂了只让那一格安静下去，不拖着整排转圈
  useEffect(() => {
    let alive = true;
    api.posts().then((d) => alive && setPosts(d.rows || [])).catch(() => alive && setPosts([]));
    api.metrics().then((d) => alive && setMetrics(d.rows || [])).catch(() => alive && setMetrics([]));
    api.materialWorkspace({ pageSize: 1 }).then((d) => alive && setMats(d.counts || {})).catch(() => alive && setMats({}));
    return () => { alive = false; };
  }, []);

  const ym = monthOf(new Date().toISOString().slice(0, 10));
  const ov = posts ? overview(posts, ym) : null;
  const byPlatform = posts ? platformSummary(inMonth(posts, ym)) : [];
  const fans = metrics ? followerTotal(metrics) : null;
  const usable = mats?.可用素材 ?? null;
  const needCheck = mats?.需核验 ?? 0;

  return (
    <div className="stats">
      <StatCard
        icon={IconSend}
        label="本月发布"
        value={ov ? ov.count : "—"}
        unit={ov ? "篇" : ""}
        delta={ov?.platforms?.length ? `${ov.platforms.length} 个渠道` : ""}
        note={byPlatform.length ? byPlatform.map((p) => `${p.platform} ${p.count}`).join(" · ") : "这个月还没发"}
        onClick={() => onGo("metrics")}
        title="去复盘看这个月的表现"
      />

      {/**
        * ⚠️ **「等你动手」的 delta 用 `warn` 不用 `up`。**
        * 这个数**涨了是坏事**——按涨跌自动上色的话，首屏会把一件坏事画成绿的。
        * 所以 `StatCard` 的 tone 是调用方给的，不是组件自己判断的。
        */}
      <StatCard
        icon={IconChartBar}
        label="等你动手"
        value={pending}
        unit="件"
        delta={topStage || ""}
        deltaTone={pending ? "warn" : ""}
        note={pending ? "从最上面那一件开始就行" : "手上没有卡住的内容"}
        onClick={() => onGo("content")}
        title="去看全部内容项目"
      />

      <StatCard
        icon={IconArchive}
        label="可用素材"
        value={usable == null ? "—" : usable}
        unit={usable == null ? "" : "条"}
        delta={needCheck ? `${needCheck} 条待核验` : ""}
        deltaTone={needCheck ? "down" : ""}
        note={needCheck ? "金句和数据要核过来源才能进成稿" : "拆好的都能直接带进下一篇"}
        onClick={() => onGo("materials", needCheck ? "需核验" : "可用素材")}
        title="去素材工作区"
      />

      <StatCard
        icon={IconUsers}
        label="粉丝"
        value={fans ? fmtNum(fans.now) : "—"}
        delta={fans?.delta == null ? "" : `${fans.delta >= 0 ? "+" : ""}${fmtNum(fans.delta)}`}
        deltaTone={fans?.delta == null ? "" : fans.delta >= 0 ? "up" : "down"}
        /* ⚠️ 环比拿不到时**照实说是为什么**，不是留一句「暂无数据」 */
        note={fans?.delta == null ? "还只有一周记录，下周就能比" : `${fans.platforms} 个平台合计 · 比上一周`}
        onClick={() => onGo("metrics")}
        title="去复盘看粉丝趋势"
      />
    </div>
  );
}
