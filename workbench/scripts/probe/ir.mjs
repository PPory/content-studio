// 探针中间表示（IR）：**所有数据规则的唯一真源**。
//
// 采集器（from-*.mjs）产出 IR，渲染器（render.mjs）消费 IR，两边互不认识。
// 加一个数据源 = 新写一个采集器，渲染层一行都不用动。
//
// ## 为什么需要 IR
//
// 探针现在有两条腿，它们给的东西**质量不一样**：
//   MediaCrawler —— 全文、评论齐全，但作者打码、数字是「1.6万」这种缩写、没有时间筛选
//   Museon      —— 精确整数、真实作者、能按周筛，但正文只给 60 字预览、没有评论
//
// 如果不区分这些差异，就会出现**由流水线自己制造的假结论**：
// 60 字的钩子被当成正文，skill 判出「这个角度写得浅」——写的人其实写了三千字。
//
// 所以 IR 里最重要的不是数据，是**数据的可信度标记**：
//
//   body: null                       这个源不给正文
//   body: { text, complete: false }  只有预览，**不能用来判断深度**
//   body: { text, complete: true }   全文
//   comments: null                   未采集（**不等于**没有评论）
//   comments: []                     采集了，确实没有
//
// 「没有」和「没取到」必须是两个不同的值。合成一个的那天，报告就开始说谎了。

/**
 * 平台返回的数字可能是「1.2万」「18,592」「--」。
 * `Number()` 得到 NaN 会静默变成空值，所以解析失败要显式返回 null，原始串另存一份。
 */
export function num(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "--" || s === "None") return null;
  const m = s.match(/^([\d.,]+)\s*(万|w|W|千|k|K)?$/);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  return Math.round(base * ({ 万: 1e4, w: 1e4, W: 1e4, 千: 1e3, k: 1e3, K: 1e3 }[m[2]] || 1));
}

/**
 * 缩写过的数字只有两位有效数字：「1.6万」真值在 1.55–1.65 万之间。
 * 由它算出的比率误差可达 ±6%，所以「1.6万/1.6万 = 100.0%」是假精度。
 * Museon 给的是精确整数，这个标记恒为 false——那条路上的收藏率可以当真值用。
 */
export const isApprox = (v) => /[万wW千kK]/.test(String(v ?? ""));

/** 小红书给毫秒、抖音给秒。按量级判断，不按平台写死——写死的话换个源就静默差 1000 倍。 */
export function ts(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e11 ? n * 1000 : n;
}

export const day = (v) => (ts(v) ? new Date(ts(v)).toISOString().slice(0, 10) : "");

/** 抖音的 aweme_type 是数字码，铺出来是一列没人看得懂的「0」。 */
export const AWEME_TYPE = { 0: "视频", 68: "图文", 51: "视频", 61: "视频" };

/**
 * 求助迹象词。
 *
 * **只认问号是不够的**：实测这批数据里最值钱的一条楼主追问
 *（「我不知道怎么办，求解答」）一个问号都没有，而它是唯一直接指向选题的评论。
 * 所以问号 + 求助词表一起认。宁可多标不可漏标——它是**标记不是筛子**，
 * 标错了不会有任何东西被丢掉。
 */
export const ASK_WORDS =
  /怎么办|怎么破|求解|求助|求建议|求推荐|请问|有没有人|有没有什么|该怎么|如何才能|为什么会|该不该|值不值|有什么办法|谁能|想问/;

/**
 * 比率可信所需的最小赞数。
 *
 * 50 是这么定的：收藏率的抽样噪声大约是 1/√n，n=50 时多一个收藏动 2 个百分点，
 * n=8 时动 12 个。低于这个数，「收藏率」量的是运气不是内容。
 * 它是**标记的阈值不是筛掉的阈值**——这些笔记仍然算进供给，只是不参与下判断。
 */
export const MIN_LIKES_FOR_RATIO = 50;

export function median(xs) {
  const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * 造一条 IR。采集器只负责把自己的字段喂进来，**所有派生值在这里算**——
 * 比率的定义只能有一份，两个采集器各算一遍迟早会算出两套不一样的收藏率。
 *
 * @param {object} r
 * @param {"museon"|"mediacrawler"} r.source 溯源。一次探针里可以混两个源，所以标在每条上而不是整份文件上。
 * @param {{text:string, complete:boolean}|null} r.body 正文三态，见文件头。
 * @param {Array|null} r.comments null = 未采集，[] = 确实没有。
 */
export function makeItem(r) {
  const liked = num(r.liked);
  const collected = num(r.collected);
  const commented = num(r.commented);
  const shared = num(r.shared);

  if (r.body != null && typeof r.body.complete !== "boolean") {
    throw new Error(`IR: body 必须带 complete 标记（${r.id}）——不标的话预览会被当成全文`);
  }

  return {
    source: r.source,
    platform: r.platform,
    group: r.group ?? "",
    groupLabel: r.groupLabel || r.group || "",
    id: r.id,
    title: r.title || "",
    body: r.body ?? null,
    kind: r.kind || "",
    date: r.date || "",
    url: r.url || "",
    // 小红书的 detail 抓取要求 URL 带 xsec_token，没有它 MediaCrawler 那一步取不到。
    // 这是「Museon 选、MediaCrawler 取」这条链能接上的唯一凭据，所以进 IR。
    xsecToken: r.xsecToken ?? null,
    tags: r.tags ?? null,
    author: r.author ?? { id: null, name: null, masked: false },
    liked,
    collected,
    commented,
    shared,
    likedRaw: r.liked,
    approx: isApprox(r.liked) || isApprox(r.collected),
    // 反响必须用比率不能用绝对值：不同时间发的内容进的流量池不是一个量级，
    // 绝对赞数跨条比没有意义。比率是自归一化的，所以能比。
    collectRate: liked && collected != null ? collected / liked : null,
    replyRate: liked && commented != null ? commented / liked : null,
    shareRate: liked && shared != null ? shared / liked : null,
    // 比率的分母太小就没有意义：♥8/藏23 = 287.5%，多一个收藏就跳 12 个百分点。
    // 实测一批里真出现过 ♥2/藏4 = 200% 排在收藏率榜首。
    // 不删这些条（它们仍是供给的一部分），但**标出来，并且不给它们贴四象限标签**——
    // 拿 4 个收藏说「小众但被存下来了」是在编。
    ratioReliable: liked != null && liked >= MIN_LIKES_FOR_RATIO,
    images: r.images ?? [],
    // 读图结果。Museon visual-analyze 填，其余源恒为 null。
    vision: r.vision ?? null,
    comments: r.comments ?? null,
  };
}

/** 一条评论。采集器之间字段名不同，这里统一。 */
export function makeComment(c) {
  const content = String(c.content || "");
  return {
    content,
    likes: num(c.likes) ?? 0,
    // 赞 = 有多少人有同感；回复数 = 有多少人有话要说。
    // 后者才标识争议点和真问题，所以它是排序主键。
    replies: num(c.replies) ?? 0,
    date: c.date || "",
    // 楼主自己补的那条常常才是这篇真正想问的问题，和路人评论不是一类东西。
    isAuthor: Boolean(c.isAuthor),
    asks: /[?？]/.test(content) || ASK_WORDS.test(content),
    chars: content.replace(/\s+/g, "").length,
    hasImage: Boolean(c.hasImage),
  };
}

/**
 * 分组统计 + 四象限。
 *
 * ## 为什么 `representative` 这个标记必须存在
 *
 * 四象限是拿每条跟**同批中位数**比。这个比法只在样本能代表该关键词的真实分布时成立。
 *
 * 踩过的坑：用 `--sort collects`（按收藏降序）取样看起来很聪明——直接拿到高收藏头部。
 * 但那样取回来的 20 条**全是收藏头部**，再算它们的中位数，等于拿高收藏的去跟
 * 高收藏的中位数比：**「刷」和「冷」两格永远是空的**。而那两格恰恰是最值钱的
 * ——「有人写了但读者没买账」正落在那里。
 *
 * 所以采集器必须声明自己的取样是不是有代表性；不是的话这里不算四象限，
 * 渲染层也不画那一列，并说明原因。**画一个必然错的格子，比不画糟得多。**
 */
export function groupStats(items, { representative = true } = {}) {
  const groups = [];
  for (const key of [...new Set(items.map((i) => i.group))]) {
    const list = items.filter((i) => i.group === key);
    const medLiked = median(list.map((i) => i.liked));
    const medCR = median(list.map((i) => i.collectRate));
    const dates = list.map((i) => i.date).filter(Boolean).sort();
    const within = (n) =>
      list.filter((i) => i.date && Date.now() - new Date(i.date).getTime() < n * 86400000).length;

    for (const i of list) {
      // **派生值每次重算，不信 json 里存的那份。**
      // 踩过：加了 `ratioReliable` 之后 `--rerender` 旧 json，字段不存在 → 全判成不可信，
      // 于是出现「20/20 条赞不足 50（赞中位数 603.5）」这种自相矛盾的话。
      // 存下来是给下游消费者看的，判断永远以这里为准。
      i.ratioReliable = i.liked != null && i.liked >= MIN_LIKES_FOR_RATIO;
      if (!representative || !i.ratioReliable) {
        // 分母太小就不贴标签。给一条 ♥8 的笔记贴「冷存（小众但被存）」，
        // 是拿 4 个收藏在下结论——比不贴糟得多。
        i.echo = "—";
        continue;
      }
      // 四象限：高赞高藏=存下来了 · 高赞低藏=刷过就走 · 低赞高藏=小众但被存 · 低赞低藏=没接住。
      const hot = i.liked != null && medLiked != null && i.liked >= medLiked;
      const sticky = i.collectRate != null && medCR != null && i.collectRate >= medCR;
      i.echo = i.collectRate == null ? "—" : hot ? (sticky ? "存" : "刷") : sticky ? "冷存" : "冷";
    }

    groups.push({
      key,
      label: list[0]?.groupLabel || key,
      count: list.length,
      medLiked,
      medCollectRate: medCR,
      medReplyRate: median(list.map((i) => i.replyRate)),
      first: dates[0] || "",
      last: dates[dates.length - 1] || "",
      within30: within(30),
      within90: within(90),
      approx: list.some((i) => i.approx),
      kinds: list.reduce((m, i) => ((m[i.kind || "?"] = (m[i.kind || "?"] || 0) + 1), m), {}),
      // 这一批里有几条拿到了全文——决定「深度」这个判断能不能下。
      withFullBody: list.filter((i) => i.body?.complete).length,
      withComments: list.filter((i) => i.comments?.length).length,
      // 分母太小的有几条。**这个数大就说明整批的收藏率中位数不可解读**，
      // 而它通常不是内容的问题，是关键词的问题——太长太书面，站内没人这么搜，
      // 于是搜索返回的全是长尾。实测「用AI 不会思考」赞中位数只有 13。
      lowSample: list.filter((i) => !i.ratioReliable).length,
      items: list,
    });
  }
  return groups;
}

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}
