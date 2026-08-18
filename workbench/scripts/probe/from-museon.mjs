// 采集器：Museon CLI → IR。
//
// Museon 相对 MediaCrawler 的取舍（决定了它在链路里的位置）：
//   ✅ 精确整数（不是「1.6万」）· 真实作者名 · 能按周筛新鲜度 · 服务端跑不碰你的账号
//   ❌ 正文只给 **60 字预览**（实测 `--content-chars 4000` 无效，硬顶 60）· 拿不到小红书评论
//
// 所以它在链路里干的是**发现**：扫出「这周这个关键词下有哪些内容、反响如何、谁写的」，
// 挑出真正要读的几条之后，交给 MediaCrawler 去取全文和评论（见 from-mediacrawler.mjs）。
//
// 计费：search / creator-posts / post 各 1 credit，visual-analyze **2 credits**。
// Free 档 1000 credits 是**终身**的，用完不再生（付费档才每月刷新）。所以这里
// 逐次记账并在结束时打出来——不是为了省，是为了让「花在哪了」看得见。

import { execFileSync } from "node:child_process";
import { makeItem } from "./ir.mjs";

/**
 * ⚠️ `--time-window` 只有这三档真正生效。
 *
 * 实测传 `month` 会**静默失效**：不报错、照样返回结果，但里面混着 5 个月前的笔记。
 * 推测是因为小红书原生筛选只有「一天内 / 一周内 / 半年内」三档，落不上的值被忽略。
 * 这种「传了参数但没生效还不报错」是最难查的一类错，所以在这里挡掉，
 * **宁可让命令跑不起来，也不要让它跑出一份你以为筛过其实没筛的数据。**
 */
const TIME_WINDOWS = new Set(["day", "week", "six-months"]);

/** 各操作的 credit 成本，用于记账。 */
const COST = { search: 1, post: 1, creator: 1, vision: 2 };

const BIN = process.platform === "win32" ? "museoncli.exe" : "museoncli";

export class Museon {
  constructor({ bin = BIN } = {}) {
    this.bin = bin;
    this.spent = 0;
    this.calls = [];
  }

  /**
   * 跑一条 museoncli 命令，返回 `data`。
   *
   * 三种失败分得很开，因为处理方式完全不同：
   *   进程失败      → 没装 / 不在 PATH
   *   ok:false      → 参数错、额度耗尽、鉴权过期，`reason` 里写着
   *   JSON 解析失败 → 输出被截断（真发生过）
   * **绝不静默降级返回空数组**——那样探针会产出一份「这个关键词没人写」的假报告。
   */
  run(args, { kind }) {
    let out;
    try {
      out = execFileSync(this.bin, [...args], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
    } catch (e) {
      const stderr = String(e.stderr || "").trim();
      if (e.code === "ENOENT") {
        throw new Error(
          `找不到 ${this.bin}。装：uv tool install "https://github.com/Museon-AI/museon-cli/releases/download/v0.5.16/museoncli-0.5.16-py3-none-any.whl"`
        );
      }
      throw new Error(`museoncli 执行失败（${args.slice(0, 3).join(" ")}）：${stderr || e.message}`);
    }

    let j;
    try {
      j = JSON.parse(out);
    } catch {
      throw new Error(`museoncli 返回的不是合法 JSON（可能被截断，${out.length} 字节）`);
    }

    if (!j.ok) {
      const detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? "");
      throw new Error(`museoncli 拒绝了请求：${j.reason || "unknown"} ${detail}`.trim());
    }

    this.spent += COST[kind] ?? 1;
    this.calls.push(kind);
    return j.data;
  }

  /** 小红书关键词搜索。一次 1 credit，返回该关键词的一页结果。 */
  searchXhs(keyword, { limit = 20, sort = "popular", timeWindow = "any", contentType = "any" } = {}) {
    if (timeWindow !== "any" && !TIME_WINDOWS.has(timeWindow)) {
      throw new Error(
        `--time-window ${timeWindow} 会被小红书静默忽略（返回的结果没筛过）。只能用：${[...TIME_WINDOWS].join(" / ")} / any`
      );
    }
    const d = this.run(
      [
        "research", "+social-media-search",
        "--platform", "xhs",
        "--intent", "keyword-search",
        "--query", keyword,
        "--limit", String(limit),
        "--sort", sort,
        "--time-window", timeWindow,
        "--content-type", contentType,
        // 60 字是硬上限，传大了也没用；传 0 反而会丢掉预览，所以给个够用的值。
        "--content-chars", "800",
      ],
      { kind: "search" }
    );
    return d?.evidence?.notes ?? [];
  }

  /** 指定博主的作品列表。对标面用。 */
  creatorPosts(userId, { limit = 20 } = {}) {
    const d = this.run(
      [
        "research", "+social-media-search",
        "--platform", "xhs",
        "--intent", "creator-posts",
        "--query", userId,
        "--limit", String(limit),
        "--content-chars", "800",
      ],
      { kind: "creator" }
    );
    return d?.evidence?.notes ?? [];
  }

  /**
   * 单条笔记详情。**这是唯一能拿到小红书全文的 Museon 接口**，1 credit 一条。
   * 但同样的全文 MediaCrawler 免费给，所以正常链路里不用它——
   * 只在「不想动 MediaCrawler、就想看这一条」的时候用。
   */
  post(noteId) {
    const d = this.run(
      ["research", "+social-media-search", "--platform", "xhs", "--intent", "post",
       "--query", noteId, "--content-chars", "4000"],
      { kind: "post" }
    );
    return d?.evidence?.post ?? null;
  }

  /**
   * 读图。**这是整条链路上唯一能读「图文笔记正文在图里」的能力**，也是最贵的（2 credits）。
   *
   * 小红书大量知识类内容是九宫格图片，`desc` 里只有钩子，干货全在图上。
   * MediaCrawler 能抓到图片 URL，但没有任何环节去读它们——那是现在的盲区。
   */
  visualAnalyze(mediaUrls, prompt) {
    const args = ["research", "+visual-analyze"];
    for (const u of mediaUrls) args.push("--media", u);
    args.push("--prompt", prompt);
    const d = this.run(args, { kind: "vision" });
    return d?.analysis ?? null;
  }

  /** 花了多少、花在哪。 */
  report() {
    const by = this.calls.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
    return { credits: this.spent, calls: by };
  }
}

/**
 * 小红书的 image_urls 会把**同一张图的不同尺寸**当成两个 URL 返回
 *（`...?imageView2/2/w/576/...` 和 `...w/1440...`，路径相同只有查询串不同）。
 * 不去重的话，读图时前 3 张里有 1–2 张是重复的——**少读了真正的内页，还照样收 2 credits**。
 * 按 `?` 前的路径去重，并优先留分辨率高的那个（w/1440 比 w/576 更容易认出小字）。
 */
function dedupeImages(urls) {
  const best = new Map();
  for (const u of urls) {
    const key = String(u).split("?")[0];
    const w = Number(String(u).match(/\/w\/(\d+)/)?.[1] || 0);
    const prev = best.get(key);
    if (!prev || w > prev.w) best.set(key, { url: u, w });
  }
  return [...best.values()].map((v) => v.url);
}

/** Museon 的一条笔记 → IR。字段映射只写这一处。 */
function toItem(n, { group, groupLabel, previewOnly = true }) {
  return makeItem({
    source: "museon",
    platform: "xhs",
    group,
    groupLabel,
    id: n.note_id,
    title: n.title || "",
    // ⚠️ 搜索结果的 desc 恒为 60 字预览，**必须标 complete:false**。
    // 标漏了的话，skill 会拿一句钩子去判断「这篇写到多深」，得出的结论是流水线造的。
    body: n.desc ? { text: n.desc, complete: !previewOnly } : null,
    kind: n.type || "",
    date: n.create_time ? new Date(n.create_time * 1000).toISOString().slice(0, 10) : "",
    // xsec_token 必须留着：MediaCrawler 的 detail 模式要求 URL 带它，
    // 这是两条腿能接上的关键（见 from-mediacrawler.mjs 的 detailUrl）。
    url: n.xiaohongshu_url || "",
    xsecToken: n.xsec_token || null,
    tags: n.hashtags ?? null,
    author: { id: n.author_user_id || null, name: n.author_nickname || null, masked: false },
    liked: n.liked_count,
    collected: n.collected_count,
    commented: n.comment_count,
    shared: n.share_count,
    images: dedupeImages(n.image_urls ?? []),
    // Museon 拿不到小红书评论（`xhs does not support intent=comments`）。
    // null 而不是 []：这是「没采集」不是「没有评论」。
    comments: null,
  });
}

/**
 * 关键词模式：一批关键词 → IR 列表。
 *
 * `sort` 默认 `popular` 而不是 `collects`，这一条是有代价才学会的：
 * 按收藏降序取样拿回来的全是收藏头部，再算这批的中位数，
 * 四象限里「刷」和「冷」两格永远是空的——而那两格正是「有人写了但读者没买账」，
 * 是整份供给审计最值钱的位置。要看收藏头部就另跑一次，别混进统计样本。
 */
export function collectKeywords(museon, keywords, opts = {}) {
  const items = [];
  for (const kw of keywords) {
    for (const n of museon.searchXhs(kw, opts)) {
      items.push(toItem(n, { group: kw, groupLabel: kw }));
    }
  }
  return items;
}

/** 对标博主模式：一批 user_id → IR 列表。 */
export function collectCreators(museon, userIds, opts = {}) {
  const items = [];
  for (const uid of userIds) {
    const notes = museon.creatorPosts(uid, opts);
    const label = notes[0]?.author_nickname || uid;
    for (const n of notes) items.push(toItem(n, { group: uid, groupLabel: label }));
  }
  return items;
}

/**
 * 哪些笔记值得读图。
 *
 * **只有一张图的笔记不值得读**——那张就是封面，上面写的是标题的变体，
 * 读回来的信息你在标题里已经有了，白花 2 credits。实测一批 20 条里
 * 有 14 条属于这种（去重后 images.length === 1）。
 *
 * 值得读的是图多的：图文笔记把干货铺在第 2 张往后的内页上，
 * 那部分内容 `desc` 里一个字都没有，是现在整条链路唯一的盲区。
 */
export function visionCandidates(items, { minImages = 2 } = {}) {
  return items.filter((i) => (i.images?.length ?? 0) >= minImages);
}

/**
 * 给指定的几条笔记读图，结果写回 `item.vision`。2 credits 一条。
 *
 * 一次最多喂 `maxImages` 张：图文笔记常有 9 张，全喂进去一次调用要处理很久，
 * 而**跳过第 1 张封面**之后的头几张通常就是正文页。
 */
export function readImages(museon, items, { maxImages = 3 } = {}) {
  const prompt =
    "这是小红书图文笔记的内页。逐条转录图中的文字（保留原文，不要概括），" +
    "然后用一句话说明这几张图讲的核心主张是什么。如果图里没有实质文字（纯封面/装饰），直接说「无正文信息」。";
  for (const it of items) {
    const imgs = it.images || [];
    // 图够多时跳过封面——封面写的是标题的变体，占一个名额不值。
    const urls = (imgs.length > maxImages ? imgs.slice(1) : imgs).slice(0, maxImages);
    if (!urls.length) continue;
    it.vision = museon.visualAnalyze(urls, prompt);
  }
  return items;
}
