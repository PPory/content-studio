// 采集器：MediaCrawler 落盘的 jsonl → IR。
//
// 它在链路里干的是**深取**：全文和评论，这两样只有它有。
//   小红书评论 —— Museon 明确不支持（`xhs does not support intent=comments`）
//   全文       —— Museon 要每条 1 credit，这里免费
//   抖音       —— Museon 的 platform 枚举里根本没有（TikTok ≠ 抖音）
//
// 代价是它跑在**你自己的账号**上，跑挂过两次（`登录已过期`、截断的 JSON）。
// 所以正确用法不是拿它盲扫，而是让 Museon 先选出该读的几条，这里只取那几条。
//
// **不 fork、不改 MediaCrawler 一行**：指定笔记走 `--specified_id`，
// 它内部会写进 `config.XHS_SPECIFIED_NOTE_URL_LIST`，不需要动配置文件。

import fs from "node:fs";
import path from "node:path";
import { makeItem, makeComment, day, AWEME_TYPE } from "./ir.mjs";

/** MediaCrawler 的落盘字段名，各平台不同。加平台只写一项。 */
export const PLATFORMS = {
  xhs: {
    label: "小红书",
    // ⚠️ 落盘目录是 data/xhs/
    dir: "xhs",
    id: "note_id",
    url: "note_url",
    time: "time",
    fk: "note_id",
    // 小红书笔记正文是完整的（图文笔记动辄上千字），所以「写到多深」看得出来。
    angleMap: true,
    sortNote: "热度（popularity_descending）",
  },
  dy: {
    label: "抖音",
    // ⚠️ 落盘目录是 data/douyin/，不是命令行那个 --platform dy。
    // 两处名字不一致，猜错了脚本会报「找不到目录」——这条只有真跑一次才知道。
    dir: "douyin",
    id: "aweme_id",
    url: "aweme_url",
    time: "create_time",
    fk: "aweme_id",
    // 抖音存的 title 就是 desc（实测 41/41 完全相同），而**视频里说了什么拿不到**。
    // 但「文案里什么都没有」是错的：实测长度分布 [22,32,48,52,61,94,138,223,971]，
    // 知识类账号会把整个脚本贴进文案。所以文案照留，
    // 但**角度地图不画**——多数文案是钩子加标签，拿它判断深度会得出假结论，
    // 而**画一个填不满的分区比不画更糟**。
    angleMap: false,
    sortNote: "综合",
  },
};

const readJsonl = (f) =>
  fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

export function jsonlDir(crawlerDir, platform) {
  return path.join(crawlerDir, "data", PLATFORMS[platform].dir, "jsonl");
}

/** 列出某个抓取类型下已有的批次日期。 */
export function availableDates(dir, crawlType) {
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^${crawlType}_(?:contents|comments)_(\\d{4}-\\d{2}-\\d{2})\\.jsonl$`);
  return [...new Set(fs.readdirSync(dir).map((f) => f.match(re)?.[1]).filter(Boolean))].sort();
}

/**
 * 读一批 jsonl → IR。
 *
 * MediaCrawler 的正文一律是全文，所以 `complete: true`；
 * 评论文件不存在时 `comments: null`（**未采集**，不是「没有评论」）——
 * 没开 `--get_comment` 时只有供给面，那也是一份有效的探针，但不能让它看起来像
 * 「这些笔记都没人评论」。
 */
export function collect({ crawlerDir, platform, crawlType, date }) {
  const P = PLATFORMS[platform];
  const dir = jsonlDir(crawlerDir, platform);
  const contentsFile = path.join(dir, `${crawlType}_contents_${date}.jsonl`);
  const commentsFile = path.join(dir, `${crawlType}_comments_${date}.jsonl`);

  const rawNotes = readJsonl(contentsFile);
  const hasComments = fs.existsSync(commentsFile);
  const rawComments = hasComments ? readJsonl(commentsFile) : [];

  const byNote = new Map();
  for (const c of rawComments) {
    const k = c[P.fk];
    if (!byNote.has(k)) byNote.set(k, []);
    byNote.get(k).push(c);
  }

  const items = rawNotes.map((n) => {
    const own = byNote.get(n[P.id]);
    const comments = hasComments
      ? (own || [])
          .map((c) =>
            makeComment({
              content: c.content,
              likes: c.like_count,
              replies: c.sub_comment_count,
              date: day(c.create_time),
              // 脱敏哈希认不出「是谁」，但认得出「是不是同一个人」。
              isAuthor: c.creator_hash === n.creator_hash,
              hasImage: Boolean(c.pictures),
            })
          )
          .sort((a, b) => b.replies - a.replies || b.likes - a.likes)
      : null;

    return makeItem({
      source: "mediacrawler",
      platform,
      group: crawlType === "creator" ? n.creator_hash : n.source_keyword || "",
      groupLabel: crawlType === "creator" ? n.nickname || n.creator_hash : n.source_keyword || "",
      id: n[P.id],
      title: n.title || "",
      body: n.desc ? { text: n.desc, complete: true } : null,
      kind: n.type || AWEME_TYPE[n.aweme_type] || (n.aweme_type ? `type${n.aweme_type}` : ""),
      date: day(n[P.time]),
      url: n[P.url],
      tags: String(n.tag_list || "").split(",").filter(Boolean),
      // MediaCrawler 把作者信息硬编码脱敏了（`save_creator` 是 no-op），
      // 所以这里的 name 是打过码的，标出来免得跟 Museon 的真名混着用。
      author: { id: n.creator_hash || null, name: n.nickname || null, masked: true },
      liked: n.liked_count,
      collected: n.collected_count,
      commented: n.comment_count,
      shared: n.share_count,
      images: [],
      comments,
    });
  });

  return { items, commentCount: rawComments.length, hasComments };
}

/**
 * 拼 detail 模式要的笔记 URL。
 *
 * 小红书的 detail 接口**必须带 xsec_token**，光有 note_id 取不到。
 * token 来自 Museon 的搜索结果——这是两条腿唯一的接口，缺了它这条链就断了。
 */
export function detailUrl(item) {
  if (!item.xsecToken) return null;
  return `https://www.xiaohongshu.com/explore/${item.id}?xsec_token=${item.xsecToken}&xsec_source=pc_search`;
}

/**
 * 生成「深取这几条」的 MediaCrawler 命令。
 *
 * 不代跑：这一步会用你的小号发请求，**什么时候跑、跑几条，应该是你按一下回车的决定**，
 * 不是脚本替你做的。跑挂过两次的教训——账号被盯上的时候，
 * 你需要的是「这次先不跑」这个选项，而不是一个已经跑起来的脚本。
 */
export function detailCommand(items, { maxComments = 15 } = {}) {
  const urls = items.map(detailUrl).filter(Boolean);
  if (!urls.length) return null;
  return {
    count: urls.length,
    cmd: [
      // `uv run` 而不是裸 `python`：MediaCrawler 有自己的 .venv，
      // 系统 python 跑它会缺一堆依赖（playwright、httpx…），报错还离得很远。
      "uv run main.py",
      "--platform xhs",
      "--type detail",
      `--specified_id "${urls.join(",")}"`,
      "--get_comment true",
      // 实测：从 10 提到 30 会让单次会话的请求量翻三倍，直接把账号跑到「登录已过期」。
      // 15 是踩出来的上限。
      `--max_comments_count_singlenotes ${maxComments}`,
    ].join(" "),
  };
}

/**
 * 把 MediaCrawler 深取回来的全文和评论合并进已有的 IR（按 note_id 对齐）。
 *
 * 合并而不是替换：Museon 那边的精确数字、真实作者名、读图结果都要留着，
 * 这里只补 MediaCrawler 独有的两样——全文和评论。
 */
export function mergeDetail(items, detail) {
  const byId = new Map(detail.map((d) => [d.id, d]));
  let merged = 0;
  for (const it of items) {
    const d = byId.get(it.id);
    if (!d) continue;
    if (d.body?.complete) it.body = d.body;
    if (d.comments) it.comments = d.comments;
    if (d.tags?.length && !it.tags?.length) it.tags = d.tags;
    it.source = "museon+mediacrawler";
    merged++;
  }
  return merged;
}
