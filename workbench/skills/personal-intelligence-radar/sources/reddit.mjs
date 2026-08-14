// Reddit：近一周的帖子 + 随帖白送的评论。
//
// 这个源补的是**观点和分歧**——评论区吵起来的地方才有「什么说法站不住了」。
// 它给不了中文视角，也给不了覆盖面（千问、Seedance 这类中国生态的事这 7 个社区不报）。

import { collect } from "../lib/brightdata.mjs";
import { pick, asNum, clip, oneLine, median, withinDays, header } from "../lib/material.mjs";

// dataset id 来自官方文档。评论那个（gd_lvzdpsdlw09j6t702）**故意不用**：
// 帖子记录自带 comments 数组（实测 35 条帖子里 29 条有，共 406 条），
// 单独跑评论 dataset 买到的是同样质量的东西——两边都不是按赞数排的，赞数都以 1 为主——
// 但那要另花一条 record。省下的是每轮 77% 的开销。
const DS_POSTS = "gd_lvz8ah06191smkebj4";

export default {
  key: "reddit",
  label: "Reddit",
  paid: true,

  plan(cfg, o) {
    const subs = cfg.subreddits || [];
    const kws = cfg.keywords || [];
    return {
      records: (subs.length + kws.length) * o.posts,
      lines: [
        `subreddit   ${subs.length} 个 × ${o.posts} 条 = ${subs.length * o.posts} records`,
        ...(kws.length ? [`关键词      ${kws.length} 个 × ${o.posts} 条 = ${kws.length * o.posts} records`] : []),
        `评论        随帖子白送，每帖展示前 ${o.show} 条 = 0 records`,
      ],
    };
  },

  async fetch(cfg, o, { key, log }) {
    const subs = cfg.subreddits || [];
    const kws = cfg.keywords || [];
    let out = [];

    if (subs.length) {
      log("  · 触发 subreddit 发现…");
      // **sort_by 必须首字母大写**（Hot / New / Top）。官方文档白纸黑字写的是小写
      // `new`/`top`/`hot`，连示例都是小写——但 API 一律回 400 且不列合法值。实测出来的。
      const sortBy = String(cfg.sortBy || "hot").replace(/^./, (c) => c.toUpperCase());
      out = out.concat(
        await collect(key, DS_POSTS, subs.map((url) => ({ url, sort_by: sortBy })),
          { discoverBy: "subreddit_url", limitPerInput: o.posts }, "subreddit", log)
      );
    }

    if (kws.length) {
      log("  · 触发关键词发现…");
      // "Past week" 是文档里给的取值，别的没验证过，所以时间过滤仍然在本地做
      out = out.concat(
        await collect(key, DS_POSTS, kws.map((keyword) => ({ keyword, date: "Past week", num_of_posts: o.posts })),
          { discoverBy: "keyword", limitPerInput: o.posts }, "关键词", log)
      );
    }
    return out;
  },

  render(raw, cfg, o) {
    const norm = raw.map((p) => ({
      url: pick(p, "url", "post_url", "link"),
      title: pick(p, "title", "post_title"),
      // description_markdown 看着更对，实测反而更脏（开头一堆空白），用 description
      body: String(pick(p, "description", "selftext", "text") || ""),
      author: pick(p, "user_posted", "author"),
      sub: pick(p, "community_name", "subreddit"),
      ups: asNum(pick(p, "num_upvotes", "upvotes", "score")),
      comments: asNum(pick(p, "num_comments", "comments_count")),
      date: pick(p, "date_posted", "created_at"),
      raw: p,
    }));

    const seen = new Set();
    const kept = withinDays(
      norm.filter((p) => p.url && !seen.has(p.url) && seen.add(p.url)),
      o.days,
      (p) => p.date
    )
      // 正文短**且**没人讨论的才丢。只有链接但底下吵了三百楼的帖子恰恰最有价值，
      // 光看正文长度会误杀。
      .filter((p) => p.body.length >= 200 || p.comments >= 10)
      // **按评论数排，不按赞数**：900 赞 12 评论是一条公告，200 赞 300 评论是一场争论。
      .sort((a, b) => b.comments - a.comments);

    // 热门帖底下常有一条自动生成的「TL;DR of the discussion」总结——那本身就是
    // 一份 LLM 二手转述，正是这份报告明确不要的东西。
    const isBot = (c) =>
      /^\s*TL;DR of the discussion generated automatically/i.test(c.comment || "") ||
      /(^|[-_])(bot|automoderator)$/i.test(String(c.user_commenting || ""));

    const commentsOf = (p) =>
      (Array.isArray(p.raw?.comments) ? p.raw.comments : [])
        .filter((c) => String(c.comment || "").trim() && !isBot(c))
        .map((c) => ({ body: String(c.comment).trim(), ups: asNum(c.num_upvotes), by: c.user_commenting || "" }))
        // 内嵌的这批**不是**按赞数排好的（大多是 1，偶尔混进几条上百赞的），自己排一遍
        .sort((a, b) => b.ups - a.ups)
        .slice(0, o.show);

    // 撑不起论断的帖子不该占一整节。没正文时看评论的**长度中位数**：梗图帖底下
    // 全是「他也跳那个舞吗」这种五个词的起哄，讨论量再高也没有一句能引用。
    // 45 这个数是数真实数据定出来的：梗图帖是 27/25/39，而「Qwen 3.8-27b coming
    // this week」——一条正经的发布消息——是 49。按直觉写 80 会把它一起杀掉。
    const substantial = (p) => p.body.length >= 200 || (commentsOf(p).length > 0 && median(commentsOf(p).map((c) => c.body.length)) >= 45);

    // 名额分两拨，因为**报告的两段各要一种信号，一根轴排序必然牺牲其中一种**。
    // 长文帖常常只有个位数评论（一篇 1647 字的 agent 复盘只有 6 条），纯按讨论量
    // 排的话它们永远进不来，而那恰恰是最容易直接变成稿子的一种。
    //
    // **按性质分，不按排名切**：只取「前 2/3 名」的话，条目少到全装得下时，
    // 一篇零评论的万字长文会因为排在前面而被标成「热议」——标签就开始说谎了。
    const HOT_MIN = 10;
    const pool = kept.filter(substantial);
    const hot = pool.filter((p) => p.comments >= HOT_MIN).slice(0, Math.round((o.top * 2) / 3));
    const hotSet = new Set(hot);
    const essays = pool.filter((p) => !hotSet.has(p)).sort((a, b) => b.body.length - a.body.length).slice(0, o.top - hot.length);
    const inFull = new Set([...hot, ...essays]);
    const rest = kept.filter((p) => !inFull.has(p));
    const totalComments = pool.reduce((n, p) => n + commentsOf(p).length, 0);

    const entry = (p, n) => {
      const cs = commentsOf(p);
      return [
        `### ${n}. ${p.title || "(无标题)"}`,
        "",
        `- 来源：${p.sub || "?"} · u/${p.author || "?"} · ↑${p.ups} · 💬${p.comments} · ${p.date || "?"}`,
        `- 链接：${p.url}`,
        "",
        p.body ? clip(p.body, 1200) : "_（无正文，价值在评论区）_",
        "",
        cs.length ? "**评论（按赞数）**\n" : "",
        ...cs.map((c) => `- （↑${c.ups}）${clip(oneLine(c.body), 400)}`),
        "",
      ].join("\n");
    };

    const md = [
      ...header({
        source: "reddit",
        week: o.week,
        days: o.days,
        stats: { posts: kept.length, detailed: hot.length + essays.length, comments: totalComments },
        note: { title: "Reddit 原始材料", desc: `近 ${o.days} 天。每条都带原链接，写报告时论断必须能溯回这里。` },
      }),
      // 空的那一栏不画标题——底下什么都没有的分区，读的人会以为内容丢了
      ...(hot.length
        ? ["## 热议", "", "> 评论区吵起来的地方。「在变什么」「反直觉点」通常藏在这里的分歧里。", "", ...hot.map((p, i) => entry(p, i + 1))]
        : []),
      ...(essays.length
        ? ["## 长文", "", "> 有完整论证的帖子，评论可能很少。「可能的选题」通常来自这里。", "", ...essays.map((p, i) => entry(p, hot.length + i + 1))]
        : []),
      // **按讨论量排序，所以第一条常常是本周最大的帖子。** 说明文案必须讲清楚
      // 「在这里」的原因是**没抓到可引用的内容**，不是「没人讨论」——上游对某些
      // 链接帖一条内嵌评论都不给，而那种帖子恰恰可能有几百楼。写成「还有什么在热」
      // 会让读的人以为这一栏都是边角料，从而漏掉当周最热的那条。
      ...(rest.length
        ? ["---", "", "## 有讨论但没抓到内容", "",
           "> 按讨论量排序。**这里的条目不是「不重要」，是没拿到可引用的正文或评论**——",
           "> 上游对部分链接帖不返回评论样本，所以 💬 数很大却一句话都引不出来。",
           "> 排在前面的几条很可能就是本周最大的讨论，要用就点链接自己看。", "",
           ...rest.map((p) => `- ↑${p.ups} 💬${p.comments} · ${p.sub} · [${p.title}](${p.url})`), ""]
        : []),
    ].join("\n");

    return { md, summary: `${kept.length} 帖 / ${hot.length + essays.length} 条详写 / ${totalComments} 条评论` };
  },
};
