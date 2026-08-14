// X：名单里那些人这周说了什么。
//
// **X 没有关键词搜索**，只能按账号 / 帖子 URL / hashtag。所以 sources.json 里那份
// 账号名单就是 X 的全部「关注领域」配置，等价于 Reddit 的 subreddit 列表。
//
// 这个源和 Reddit 都是英文观点层，**重复度是三个源里最高的**。它的增量在两处：
// 名单里的中文账号（Reddit 完全没有），以及一线的人在事情发生当天就说了什么
// （Reddit 的讨论往往滞后一天）。
//
// ⚠️ 阈值还没校准过。Reddit 那边的每个数字都是数过真实数据定出来的，X 这边
// 没有数据可数——**第一轮跑完要照 Reddit 的做法重新量一遍**，别把下面这些当定论。

import { collect } from "../lib/brightdata.mjs";
import { pick, asNum, clip, oneLine, infoLen, withinDays, header } from "../lib/material.mjs";

const DS_POSTS = "gd_lwxkxvnf1cynvib9co";

export default {
  key: "x",
  label: "X",
  paid: true,

  plan(cfg, o) {
    const n = (cfg.accounts || []).length;
    return {
      records: n * o.xposts,
      lines: [`账号        ${n} 个 × ${o.xposts} 条 = ${n * o.xposts} records`],
    };
  },

  async fetch(cfg, o, { key, log }) {
    const accounts = cfg.accounts || [];
    if (!accounts.length) return [];
    log(`  · 触发 ${accounts.length} 个账号的帖子发现…`);
    // **start_date 是省钱的关键**：官方文档只写了入参 url，但 400 报错回显的
    // 补全 payload 里有 start_date / end_date。不传的话拿回来的是「最近 N 条」，
    // 低频账号那几条可能是几周前的——实测 60 条里 14 条超出 7 天窗口，
    // 白付 23%。传了就在上游截断，不用付这笔钱。
    const start = new Date(Date.now() - o.days * 86400_000).toISOString().slice(0, 10);
    return collect(
      key,
      DS_POSTS,
      accounts.map((a) => ({ url: `https://x.com/${String(a).replace(/^@/, "")}`, start_date: start, end_date: "" })),
      { discoverBy: "profile_url", limitPerInput: o.xposts },
      "X",
      log
    );
  },

  render(raw, cfg, o) {
    const norm = raw.map((p) => ({
      url: pick(p, "url"),
      // X 把正文放在 description 里，不是 text/content
      text: String(pick(p, "description", "text") || "").trim(),
      by: String(pick(p, "user_posted", "user_name") || "").replace(/^@/, ""),
      // 从谁的主页发现的。上游把它记在 discovery_input 里，和 user_posted 不是一回事
      acct: String(p?.discovery_input?.url || "").split("/").filter(Boolean).pop() ||
            String(pick(p, "user_posted") || "").replace(/^@/, ""),
      date: pick(p, "date_posted"),
      likes: asNum(pick(p, "likes")),
      replies: asNum(pick(p, "replies")),
      reposts: asNum(pick(p, "reposts")),
      views: asNum(pick(p, "views")),
      followers: asNum(pick(p, "followers")),
      // 引用转评里常常才是「在变什么」的现场：有人在反驳别人
      quoted: oneLine(typeof p.quoted_post === "string" ? p.quoted_post : p.quoted_post?.description || ""),
      raw: p,
    }));

    const seen = new Set();
    const kept = withinDays(
      norm.filter((p) => p.url && p.text && !seen.has(p.url) && seen.add(p.url)),
      o.days,
      (p) => p.date
    )
      // 一句话的吆喝（「gm」「this」「🔥」）没有可引用的内容。**但引用转评例外**——
      // 短一句「这就是问题所在」配上被引用的原帖，信息是完整的。
      //
      // **必须用 infoLen 不能用 text.length**：按字符数卡的话，中文账号会被系统性
      // 砍掉——实测被砍的中文条目全是有内容的（一条 58 字的 DeepSeek agent 线索），
      // 而同一条规则在英文那边砍掉的是「ai」「fav button on LI right now」。
      // 那四个中文账号是名单里唯一补「中文表达角度」的，砍掉它们等于白配。
      .filter((p) => infoLen(p.text) >= 60 || p.quoted);

    // 按账号分组：X 的价值是「这个人在说什么」，打散按互动排会把这条线索弄丢。
    //
    // **分组键是 discovery_input.url（我们查的那个人），不是 user_posted（实际作者）。**
    // 名单里的人回复或引用别人时，上游回的记录里 user_posted 是**对方**——按它分组的话，
    // 20 个账号会分出 29 个组，凭空冒出 openai、techcrunch 这些从没在名单里的名字，
    // 而「这条是从谁的时间线上来的」这个唯一有用的归属信息就丢了。
    const byUser = new Map();
    for (const p of kept) {
      const k = p.acct.toLowerCase();
      if (!byUser.has(k)) byUser.set(k, []);
      byUser.get(k).push(p);
    }
    const groups = [...byUser.values()]
      .map((list) => ({
        acct: list[0].acct,
        // **粉丝数只能取自这个人自己发的帖**。followers 属于 user_posted，
        // 而组里混着名单成员回复/引用的别人的帖子——随手取第一条非零值的话，
        // TechCrunch 的 1070 万会被挂到 @steipete 名下。取不到就不显示：
        // 宁可少一个字段，也不放一个看着像真的假数。
        followers: list.find((p) => p.by.toLowerCase() === list[0].acct.toLowerCase() && p.followers)?.followers || 0,
        // 组内按互动排，只展示前几条——一个人一周发几十条，全铺出来会把材料淹掉
        posts: list.sort((a, b) => b.likes + b.replies - (a.likes + a.replies)).slice(0, o.xshow),
        peak: Math.max(...list.map((p) => p.likes + p.replies)),
        total: list.length,
      }))
      .sort((a, b) => b.peak - a.peak);

    const md = [
      ...header({
        source: "x",
        week: o.week,
        days: o.days,
        stats: { accounts: groups.length, posts: kept.length },
        note: {
          title: "X 原始材料",
          desc: `近 ${o.days} 天，按账号分组。名单里没抓到东西的账号不会出现——连续几周不出现就该从名单里砍掉。`,
        },
      }),
      ...groups.flatMap((g) => [
        `## @${g.acct}${g.followers ? ` · ${g.followers.toLocaleString()} 粉丝` : ""}`,
        "",
        `> 本周 ${g.total} 条，下面是互动最高的 ${g.posts.length} 条。`,
        "",
        ...g.posts.map((p) =>
          [
            `- **${p.date?.slice(0, 10) || "?"}** · ♥${p.likes} 💬${p.replies} 🔁${p.reposts}${p.views ? ` 👁${p.views}` : ""}`,
            // 作者和被查的账号不一致 = 名单里的人在回复/引用别人。写清楚是谁说的，
            // 不然「karpathy 说了 X」这种引用会张冠李戴——报告里的每句引述都要能溯源到人。
            ...(p.by && p.by.toLowerCase() !== g.acct.toLowerCase() ? [`  （原作者 @${p.by}，出现在 @${g.acct} 的时间线上）`] : []),
            `  ${clip(oneLine(p.text), 700)}`,
            ...(p.quoted ? [`  ↳ 引用：${clip(p.quoted, 300)}`] : []),
            `  ${p.url}`,
            "",
          ].join("\n")
        ),
      ]),
      ...(groups.length ? [] : ["_（这一周一条都没抓到。名单里的 handle 拼错会静默返回空，先核对一下。）_", ""]),
    ].join("\n");

    return { md, summary: `${groups.length} 个账号 / ${kept.length} 条` };
  },
};
