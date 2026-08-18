// IR → Markdown + JSON。**不碰采集，不下判断。**
//
// 这一层唯一的纪律：**只呈现 IR 里真有的东西**。
// 正文是 60 字预览就说是预览，评论没采集就说没采集，四象限样本有偏就不画那一列。
// 角度地图和评论四分类一律留空给 skill 填——脚本一旦开始猜，
// 「这个角度没人写」就可能是脚本自己造出来的。

import { groupStats, MIN_LIKES_FOR_RATIO } from "./ir.mjs";

// 缩写数字算出来的比率带 ~：提醒它只精确到个位百分点，不能拿来分高下。
const pct = (r, approx = false) =>
  r == null ? "—" : approx ? `~${Math.round(r * 100)}%` : `${(r * 100).toFixed(1)}%`;
const n2 = (v, raw) => (v == null ? String(raw ?? "—") : v.toLocaleString("en-US"));
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n+/g, " ");
// 抖音的「标题」就是整段文案，最长 971 字，直接当小标题会铺满屏。取第一行就够认出是哪一条。
const head = (t) => (String(t).split("\n")[0] || "").slice(0, 48) || "（无标题）";

const SOURCE_LABEL = {
  museon: "Museon",
  mediacrawler: "MediaCrawler",
  "museon+mediacrawler": "Museon 选 + MediaCrawler 取",
};

/**
 * @param {object} ctx
 * @param {boolean} ctx.representative 取样是否有代表性——false 时不画四象限，见 ir.mjs 的说明
 * @param {boolean} ctx.angleMap 画不画角度地图（抖音不画）
 */
export function render(items, ctx) {
  const {
    week, date, platformLabel, crawlType, coverageLimit,
    representative = true, angleMap = true, sources = [],
  } = ctx;

  const groups = groupStats(items, { representative });
  const allComments = items.flatMap((i) => i.comments || []);
  // null（未采集）和 []（真没有）要分开统计，否则「0 条评论」会同时表示两件事。
  const uncollected = items.filter((i) => i.comments === null).length;
  const withFullBody = items.filter((i) => i.body?.complete).length;
  const previewOnly = items.filter((i) => i.body && !i.body.complete).length;
  const withVision = items.filter((i) => i.vision).length;

  const L = [];
  L.push(`# ${platformLabel}站内探针 · ${crawlType === "creator" ? "对标博主" : "关键词"} · ${date}`);
  L.push("");
  L.push(
    `> ${items.length} 条内容 · ${allComments.length} 条一级评论 · 周次 ${week} · 数据源 ${sources.map((s) => SOURCE_LABEL[s] || s).join(" + ")}`
  );
  L.push(`> **覆盖边界**：${coverageLimit}`);
  L.push("");

  // ---- 数据完整度。放最前面，因为它决定下面哪些结论能下、哪些不能。----
  L.push(`## 这份数据能支撑什么判断`);
  L.push("");
  L.push(`| 维度 | 状态 | 能不能下判断 |`);
  L.push(`|---|---|---|`);
  // 正文这一行的结论要看平台：抖音存的是**文案**，不是视频里说的话，
  // 拿它判断深度会得出假结论——所以 angleMap 关掉的平台，这里不能说「可以判断深度」。
  L.push(
    `| 正文 | 全文 ${withFullBody} 条${previewOnly ? ` · **仅 60 字预览 ${previewOnly} 条**` : ""} | ` +
      (!angleMap
        ? `**判断不了深度**——这里的「正文」是视频文案，不是视频内容`
        : previewOnly
          ? `预览那些**不能判断深度**——一句钩子看不出写没写透`
          : `可以判断「写到多深」`) +
      ` |`
  );
  L.push(
    `| 评论 | ${allComments.length} 条${uncollected ? ` · **${uncollected} 条内容未采集评论**` : ""} | ` +
      (allComments.length ? `可以看需求面` : `**没有需求面证据**，别从这份文件推「读者想要什么」`) +
      ` |`
  );
  // 只有真拿到图片 URL 的源（Museon）才谈读图。MediaCrawler 一张图都不给，
  // 对着它的数据说「你还没读图」是在提醒一件根本做不到的事——
  // 和画一个填不满的分区是同一个毛病。
  if (items.some((i) => i.images?.length)) {
    L.push(
      `| 图内文字 | ${withVision ? `已读 ${withVision}/${items.length} 条` : "未读"} | ` +
        (withVision
          ? `**只有这 ${withVision} 条**的图内文字可用，其余的正文你仍然只看到了钩子`
          : `图文笔记的干货在图里，**没读图 = 这些笔记的正文你只看到了钩子**（\`--vision N\`）`) +
        ` |`
    );
  }
  L.push(
    `| 反响四象限 | ${representative ? "可用" : "**不可用**"} | ` +
      (representative
        ? `样本按平台热度序取，能代表分布`
        : `取样按收藏排序，样本全是收藏头部——**「刷」和「冷」两格必然为空，四象限无意义**`) +
      ` |`
  );
  L.push("");

  L.push(`## 怎么读这份文件`);
  L.push("");
  L.push(`**「有没有人写过」是个会得出错误结论的问法**——答案几乎永远是「有」。这份文件要答的是：`);
  L.push(`同一个话题被切成了哪几个角度、哪个角度挤哪个空、挤的那个写透了没、读者到底买不买账。`);
  L.push("");
  L.push(`- **反响看比率不看绝对值。** 不同时间发的内容流量池不是一个量级，绝对赞数跨条比没有意义。`);
  L.push(
    `  \`收藏率 = 藏/赞\`（高 = 被存下来反复看的工具性内容，低 = 刷过就走）、\`评赞比 = 评/赞\`（高 = 引发讨论）。`
  );
  if (representative) {
    L.push(
      `- **反响列是四象限**，和**同一批**的中位数比（不跨批比）：\`存\`=高赞高藏 · \`刷\`=高赞低藏 · \`冷存\`=低赞高藏 · \`冷\`=低赞低藏。`
    );
    L.push(
      `  **最值钱的一格不是「没人写」**——没人写往往意味着没需求——**而是有人写了却落在「刷」或「冷」**：角度对、执行不对，最好切入。`
    );
  }
  if (allComments.length) {
    L.push(`- **评论按回复数排，不按赞排。** 赞 = 有多少人有同感；回复数 = 有多少人有话要说。`);
    L.push(
      `  按赞筛会筛掉最值钱的：实测最关键的一条楼主追问只有 ♥27，而点赞过千的多是「太真实了」这类无信息量的共鸣。`
    );
  }
  const blanks = [angleMap && "角度、覆盖层级", allComments.length && "评论分类"].filter(Boolean);
  if (blanks.length) {
    L.push(`- **${blanks.join("、")}表脚本一律留空**，由 skill 填。脚本一旦开始猜，`);
    L.push(`  「这个角度没人写」就可能是脚本自己造出来的。`);
  }
  if (!angleMap) {
    L.push("");
    L.push(
      `⚠️ **${platformLabel}拿到的是文案，不是视频内容。** 文案长度实测从 22 到 971 字不等——知识类账号会把整个脚本贴进去，但多数只是钩子加标签，**视频里说了什么一个字都没有**。所以这份主要回答**「这个选题在短视频侧爆过没有」**；角度地图不画，拿钩子判断深度会得出假结论。`
    );
  }
  L.push("");

  for (const g of groups) {
    L.push(`---`);
    L.push("");
    L.push(`## ${crawlType === "creator" ? "博主" : "关键词"}：${g.label}`);
    L.push("");
    L.push(`### 供给面`);
    L.push("");
    L.push(
      `**${g.count} 条** · 发布跨度 \`${g.first}\` → \`${g.last}\`（近 30 天 ${g.within30} 条 / 近 90 天 ${g.within90} 条） · ` +
        Object.entries(g.kinds).map(([k, v]) => `${k} ${v}`).join(" · ")
    );
    L.push("");
    L.push(
      `中位数：赞 ${n2(g.medLiked)} · 收藏率 ${pct(g.medCollectRate, g.approx)} · 评赞比 ${pct(g.medReplyRate, g.approx)}`
    );
    L.push(
      `<sub>全文 ${g.withFullBody}/${g.count} 条 · 有评论 ${g.withComments}/${g.count} 条` +
        (g.lowSample ? ` · **赞不足 ${MIN_LIKES_FOR_RATIO} 的 ${g.lowSample}/${g.count} 条**` : "") +
        `</sub>`
    );
    // 一批里过半是长尾时，收藏率中位数量的是运气不是内容。**当场说，别让人读完才发现。**
    if (g.lowSample > g.count / 2) {
      L.push("");
      L.push(
        `> ⚠️ **这一批的收藏率中位数不可解读。** ${g.lowSample}/${g.count} 条赞不足 ${MIN_LIKES_FOR_RATIO}（赞中位数只有 ${n2(g.medLiked)}），`
      );
      L.push(
        `> 比率的分母太小——♥8/藏23 就是 287.5%，多一个收藏跳 12 个百分点。这些条的「反响」列一律留空。`
      );
      L.push(
        `> 而且这通常**不是内容的问题，是关键词的问题**：太长、太书面，站内没人这么搜，返回的自然全是长尾。`
      );
      L.push(`> 换成用户真会打的词再搜一次（对照：同批里赞中位数上百的关键词才是真实搜索词）。`);
    }
    L.push("");
    const echoCol = representative ? "反响 | " : "";
    const echoSep = representative ? "---|" : "";
    L.push(`| ${echoCol}标题 | 作者 | 日期 | 赞 | 藏 | 收藏率 | 评 | 评赞比 | 转 |`);
    L.push(`|${echoSep}---|---|---|---:|---:|---:|---:|---:|---:|`);
    for (const i of [...g.items].sort((a, b) => (b.liked ?? 0) - (a.liked ?? 0))) {
      // 打码的作者名标个星号，免得跟 Museon 那边的真名混着当同一回事用。
      const who = i.author?.name ? `${esc(i.author.name)}${i.author.masked ? "*" : ""}` : "—";
      L.push(
        `| ${representative ? `${i.echo} | ` : ""}[${esc(head(i.title)).slice(0, 32)}](${i.url}) | ${who} | ${i.date} | ${n2(i.liked, i.likedRaw)} | ${n2(i.collected)} | ${pct(i.collectRate, i.approx)} | ${n2(i.commented)} | ${pct(i.replyRate, i.approx)} | ${n2(i.shared)} |`
      );
    }
    if (g.items.some((i) => i.author?.masked)) {
      L.push("");
      L.push(`<sub>\\* = 作者名被 MediaCrawler 脱敏，认不出是谁；Museon 那条路上是真名。</sub>`);
    }
    L.push("");

    if (angleMap) {
      L.push(`#### 角度地图（skill 填，脚本不猜）`);
      L.push("");
      L.push(`| 角度 | 条数 | 收藏率中位 | 最新一条 | 覆盖层级 | 缺口判断 |`);
      L.push(`|---|---:|---:|---|---|---|`);
      L.push(`| | | | | | |`);
      L.push("");
      L.push(
        `覆盖层级：\`news_rewrite\` / \`basic_explanation\` / \`mechanism\` / \`framework\` / \`practice\` / \`synthesis\`。`
      );
      L.push(
        `缺口判断：几乎无供给 / 有转述缺解释 / 有解释缺框架 / 有观点缺实操 / 英文全中文缺 / **有人写但反响差** / 已被说透不值得写。`
      );
      if (g.withFullBody < g.count) {
        L.push("");
        L.push(
          `⚠️ 这一批只有 ${g.withFullBody}/${g.count} 条拿到了全文，**其余的「覆盖层级」填不了**——`
        );
        L.push(`60 字预览判断不出写到哪一层。要填满先把那几条深取回来。`);
      }
      L.push("");
    }

    const groupComments = g.items.flatMap((i) => (i.comments || []).map((c) => ({ ...c, note: i.title, url: i.url })));
    if (groupComments.length) {
      L.push(`### 需求面（${groupComments.length} 条评论）`);
      L.push("");
      L.push(
        `有求助迹象 ${groupComments.filter((c) => c.asks).length} 条 · 楼主自己发的 ${groupComments.filter((c) => c.isAuthor).length} 条 · 引发过回复的 ${groupComments.filter((c) => c.replies > 0).length} 条`
      );
      L.push("");
      L.push(`#### 最引发讨论的（每篇取前 2 条，再按回复数排）`);
      L.push("");
      // **回复数和赞一样，跨笔记不可比**：3000 条评论的帖子回复数天然在几百，
      // 20 条评论的帖子只有个位数。直接全局排序，排出来的是「哪篇评论多」，
      // 而那一篇会用它的梗霸占整个榜单（实测前 13 有 8 条来自同一篇玩梗帖）。
      // 先在每篇内部取头部再合并，换来的是横向铺开——要的是「哪句话引爆了讨论」。
      const perNote = g.items.flatMap((i) =>
        (i.comments || []).slice(0, 2).map((c) => ({ ...c, note: i.title, url: i.url }))
      );
      for (const c of perNote.sort((a, b) => b.replies - a.replies).slice(0, 20)) {
        L.push(
          `- 💬${c.replies} ♥${c.likes}${c.isAuthor ? " · **楼主**" : ""}${c.asks ? " · ❓" : ""} · ${esc(c.content) || "（图片）"}`
        );
        L.push(`  <sub>《${esc(c.note).slice(0, 24)}》</sub>`);
      }
      L.push("");
      const q = groupComments.filter((c) => c.asks).sort((a, b) => b.replies - a.replies || b.likes - a.likes);
      if (q.length) {
        L.push(`#### 有求助迹象的评论（${q.length} 条，问号或求助词，按回复数）`);
        L.push("");
        for (const c of q.slice(0, 25)) {
          L.push(`- 💬${c.replies} ♥${c.likes}${c.isAuthor ? " · **楼主**" : ""} · ${esc(c.content)}`);
        }
        L.push("");
      }
      L.push(`#### 评论分类（skill 填，脚本不猜）`);
      L.push("");
      L.push(`| 类型 | 条数 | 代表评论 | 喂给报告哪一节 |`);
      L.push(`|---|---:|---|---|`);
      L.push(`| 求助型（提出没被解决的问题） | | | 读者问题 / 内容机会 |`);
      L.push(`| 反驳型（挑战笔记的主张） | | | 认知冲突与反共识 |`);
      L.push(`| 经验型（给出自己摸出的解法） | | | 写作时的靶子，**不能当新东西讲** |`);
      L.push(`| 共鸣型（"太真实了"） | | | 情绪证据，计数即可 |`);
      L.push("");
    } else if (g.items.some((i) => i.comments === null)) {
      L.push(`### 需求面`);
      L.push("");
      L.push(`**这一批没有采集评论**——不是这些内容没人评论。要看需求面，把要读的几条深取回来。`);
      L.push("");
    }
  }

  // ---- 逐条正文 ----
  const bodied = items.filter((i) => i.body || i.vision);
  if (bodied.length) {
    L.push(`---`);
    L.push("");
    L.push(`## 逐条：正文与评论`);
    L.push("");
    L.push(`<sub>每条只列前 8 条评论（按回复数），**全量在同名 .json 里**。</sub>`);
    L.push("");
    for (const g of groups) {
      for (const i of [...g.items].sort((a, b) => (b.liked ?? 0) - (a.liked ?? 0))) {
        if (!i.body && !i.vision) continue;
        L.push(`### ${head(i.title)}`);
        L.push("");
        L.push(
          `\`${i.date}\`${representative ? ` · ${i.echo}` : ""} · ♥${n2(i.liked, i.likedRaw)} · 藏${n2(i.collected)}（${pct(i.collectRate, i.approx)}） · 评${n2(i.commented)}` +
            `${i.author?.name ? ` · @${esc(i.author.name)}${i.author.masked ? "*" : ""}` : ""} · [原文](${i.url})`
        );
        if (i.tags?.length) L.push(`标签：${i.tags.map((t) => `#${t}`).join(" ")}`);
        L.push("");
        if (i.body?.complete) {
          // 正文原样给出不截断：判断「这个角度写到多深」靠的就是正文本身。
          L.push(i.body.text);
        } else if (i.body) {
          L.push(`> **⚠️ 以下只是 60 字预览，不是正文。** 判断深度请先深取。`);
          L.push(`>`);
          L.push(`> ${esc(i.body.text)}`);
        } else {
          L.push(`（未取正文）`);
        }
        L.push("");
        if (i.vision) {
          L.push(`<details><summary>📖 图内文字（Museon 读图，前 ${Math.min(3, i.images.length)} 张）</summary>`);
          L.push("");
          L.push(i.vision);
          L.push("");
          L.push(`</details>`);
          L.push("");
        }
        for (const c of (i.comments || []).slice(0, 8)) {
          L.push(
            `- 💬${c.replies} ♥${c.likes}${c.isAuthor ? " · **楼主**" : ""}${c.asks ? " · ❓" : ""} · ${esc(c.content) || (c.hasImage ? "（图片）" : "（空）")}`
          );
        }
        if ((i.comments?.length ?? 0) > 8) {
          L.push(`- <sub>…另有 ${i.comments.length - 8} 条，见 .json</sub>`);
        }
        L.push("");
      }
    }
  }

  return { md: L.join("\n"), groups };
}

export function toJson(items, groups, ctx) {
  return JSON.stringify(
    {
      schema_version: 3,
      week: ctx.week,
      platform: ctx.platform,
      crawl_type: ctx.crawlType,
      sources: ctx.sources,
      representative_sample: ctx.representative,
      crawled_date: ctx.date,
      note_count: items.length,
      comment_count: items.reduce((s, i) => s + (i.comments?.length ?? 0), 0),
      full_body_count: items.filter((i) => i.body?.complete).length,
      preview_only_count: items.filter((i) => i.body && !i.body.complete).length,
      vision_count: items.filter((i) => i.vision).length,
      coverage_limit: ctx.coverageLimit,
      credits: ctx.credits ?? null,
      groups: groups.map(({ items: _i, ...g }) => g),
      items,
    },
    null,
    2
  );
}
