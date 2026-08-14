// AI HOT 日报：中文的事实层。
//
// 公开只读、免 key、**不走 Bright Data，所以一分钱不花**。
// 工作台的热点页已经在用同一个站的 hot-topics / items / stories 三个端点
// （server/lib/aihot.mjs），但 dailies 一直没接——这个源就是补那一块。
//
// 它补的是 Reddit 的两个短板：
//   1. 中文。Reddit 那 7 个英文社区不报千问开放平台、Seedance 这类中国生态的事。
//   2. 事实层。日报是编辑过的「发生了什么 + 中文摘要 + 原文链接」。
//
// 它**给不了讨论**。日报没有评论区，所以「什么说法站不住了」这种判断
// 一条都不会从这儿来——那是 Reddit 的活。两个源互补，不重复。

import { proxyFetch } from "../../../server/lib/fetch.mjs";
import { oneLine, clip, header } from "../lib/material.mjs";

const ORIGIN = "https://aihot.virxact.com";
const TIMEOUT_MS = 15_000;

async function getJson(path) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await proxyFetch(`${ORIGIN}${path}`, { headers: { Accept: "application/json" }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const ymd = (d) => d.toISOString().slice(0, 10);

export default {
  key: "aihot",
  label: "AI HOT 日报",
  paid: false,

  plan(cfg, o) {
    return { records: 0, lines: [`日报        近 ${o.days} 天 = 0 records（免费源，不占 Bright Data 额度）`] };
  },

  async fetch(cfg, o, { log }) {
    log(`  · 拉近 ${o.days} 天的日报…`);
    const out = [];
    for (let i = 0; i < o.days; i++) {
      const d = new Date(Date.now() - i * 86400_000);
      try {
        const j = await getJson(`/api/v1/dailies/${ymd(d)}`);
        if (j?.report) out.push(j.report);
      } catch {
        // 某一天没有日报是正常的（实测产量很不稳），跳过就好，不算失败
      }
    }
    log(`  · 拿到 ${out.length}/${o.days} 天`);
    return out;
  },

  render(raw, cfg, o) {
    // **按分区合并、每条标日期**，不按天分节：报告问的是「这周有什么新东西」，
    // 按分区能一眼看出「模型发布 5 条、行业动态 3 条」；按天则要跨 7 个小节自己汇总。
    // 日期作为每条的元信息留着，需要时序时照样查得到。
    const bySection = new Map();
    let total = 0;
    for (const rep of raw) {
      for (const sec of rep.sections || []) {
        const label = sec.label || "其他";
        if (!bySection.has(label)) bySection.set(label, []);
        for (const it of sec.items || []) {
          if (!it?.title) continue;
          bySection.get(label).push({
            date: rep.date,
            title: oneLine(it.title),
            summary: oneLine(it.summary),
            source: oneLine(it.source?.name),
            link: it.links?.original || it.links?.aihot || "",
          });
          total++;
        }
      }
      for (const f of rep.flashes || []) {
        if (!f?.title) continue;
        if (!bySection.has("快讯")) bySection.set("快讯", []);
        bySection.get("快讯").push({
          date: rep.date,
          title: oneLine(f.title),
          summary: oneLine(f.summary),
          source: oneLine(f.source?.name),
          link: f.links?.original || f.links?.aihot || "",
        });
        total++;
      }
    }

    // 分区按条数排，多的在前——这周哪一类东西最多，本身就是个信号
    const sections = [...bySection.entries()].sort((a, b) => b[1].length - a[1].length);

    const md = [
      ...header({
        source: "aihot",
        week: o.week,
        days: o.days,
        stats: { days: raw.length, items: total, sections: sections.length },
        note: {
          title: "AI HOT 日报材料",
          desc: "中文事实层：发生了什么、谁报的、原文在哪。**这里没有讨论**——「大家怎么吵的」要去 Reddit 那份找。摘要是 AI HOT 二次加工的，写进报告前要点原文核一遍。",
        },
      }),
      ...sections.flatMap(([label, items]) => [
        `## ${label}（${items.length} 条）`,
        "",
        ...items.map((it) =>
          [
            `- **${it.date?.slice(5) || "?"}** ${it.title}`,
            it.summary ? `  ${clip(it.summary, 300)}` : "",
            `  ${it.source ? `${it.source} · ` : ""}${it.link}`,
          ]
            .filter(Boolean)
            .join("\n")
        ),
        "",
      ]),
      ...(total ? [] : ["_（这一周一条日报都没拿到。上游可能改版了，去 https://aihot.virxact.com/agent?tab=api 看看。）_", ""]),
    ].join("\n");

    return { md, summary: `${raw.length} 天 / ${total} 条 / ${sections.length} 个分区` };
  },
};
