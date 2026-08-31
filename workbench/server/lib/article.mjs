// 把一个网页地址读成正文 Markdown，让热点条目能**在工作台里看完**，不用先跳出去。
//
// 为什么值得做：热点这一页的动线是「扫一眼 → 觉得有用 → 入库」。中间那一步「点开看看」
// 原来要跳到浏览器新标签、看完再跳回来，回来时滚动位置和刚才扫到哪儿全丢了。
// 正文进了工作台之后，划词存素材是顺手的事——和读书那条链完全一样。
//
// **提取用 Readability**（Firefox 阅读模式那套），不自己写「找最长的 div」：
// 那类启发式在国内站点上错得很难看（把推荐位当正文、把正文切一半），而 Readability
// 是被几亿次点击磨出来的。它要一个 DOM，所以配 linkedom（纯 JS，不起浏览器）。
//
// 转 Markdown 复用 `books.mjs` 的 `xhtmlToMd`——它本来就是干这个的（epub 也是 XHTML），
// 而且已经处理好了中文强调标记、装饰符、引用块那些坑。
//
// **抓不到是常态，不是异常。** 很多站点挡爬虫、或者正文要 JS 才渲染得出来。
// 那时候要说人话并且把原链接给回去，不能只丢一句「失败」。

import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { proxyFetch } from "./fetch.mjs";
import { xhtmlToMd } from "./books.mjs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const err = (message, hint, status = 502) => Object.assign(new Error(message), { hint, status });

/**
 * 抓不到时**说清楚是哪一类抓不到**。
 *
 * 「提取失败」这四个字对用户没有任何用——他要判断的是「是我网络的问题、还是这个站
 * 本来就抓不到、要不要再试一次」。已知抓不到的站点直接点名，省掉一次无谓的重试。
 *
 * 公众号是实测过的：对非浏览器客户端只回一个空壳，正文要 JS 才渲染。除非上无头浏览器，
 * 否则这条路走不通——而为了一个站点在工作台里塞一个 Chromium 不划算。
 */
const IS_WEIXIN = (host) => /(^|\.)mp\.weixin\.qq\.com$/.test(host);
const IS_WALLED = (host) => /(^|\.)(zhihu|xiaohongshu|douyin|bilibili)\.com$/.test(host);

/** 已知「没有浏览器就读不出正文」的站点。见下面 `readArticle` 里的分流。 */
const needsBrowser = (host) => IS_WEIXIN(host) || IS_WALLED(host);

function whyNot(host, env = {}) {
  // 没配 Firecrawl 时，「配一个就能读」本身就是最有用的下一步——比「去原网页看」值钱
  const tip = env.FIRECRAWL_API_KEY || env.FIRECRAWL_BASE_URL
    ? "开原网页看吧"
    : "这类页面要真浏览器才渲染得出来：在 .env 里配 FIRECRAWL_API_KEY（或自托管的 FIRECRAWL_BASE_URL）就能读，否则只能开原网页";
  if (IS_WEIXIN(host)) return `公众号的正文要在微信里才渲染得出来（服务端只能拿到一个空壳）。${tip}`;
  if (IS_WALLED(host)) return `这类站点对非浏览器请求只回一个空壳。${tip}`;
  return `多半是要 JS 才渲染得出来（或者本来就是个列表页）。${tip}`;
}

/**
 * **抓回来的是验证墙，不是正文。**
 *
 * 挡爬虫的站点不一定回空壳，也可能回一整张「安全验证 / 请拖动物体完成验证 / 我不会 /
 * 换一组」的验证页，而 Readability 会忠实地把这些字提取出来（实测 139 字），
 * 轻松越过下面那道「太短」的门槛——于是界面上渲染出一篇由验证码文案拼成的「正文」，
 * 比直接报错糟得多：用户会以为这篇文章本身就是这样的乱码。
 *
 * **这是给未知站点兜底的启发式。** 已知要浏览器的那几个域名不走这条路，在
 * `readArticle` 开头就按域名断掉了——那一层是确定的，不该靠猜。
 *
 * 判据是**短 + 命中特征词**，两个条件都要。只看关键词的话，一篇正经讨论风控和验证码的
 * 文章会被误杀；而验证页天生短——真正文里出现这些词时，周围总还有几千字。
 *
 * 门槛定在 250 字。**要偏向「宁可误报抓不到」**，因为两种误判的代价差得远：误报的代价是
 * 用户点一下跳去原网页，而且被判成墙之后还会先试 Firecrawl（配了的话照样读到真正文）；
 * 漏报的代价是满屏验证码文案冒充正文，用户只会以为工作台坏了。但也不能一路调高——
 * 250 到 400 字之间是正经短文的地盘，单测里那篇 398 字的风控短文就是钉这条边界的。
 */
const WALL_WORDS =
  /安全验证|人机验证|滑动验证|拖动.{0,4}完成验证|完成.{0,4}验证|环境异常|访问(过于)?频繁|请输入验证码|verification code|are you a robot|checking your browser/i;

/**
 * 中文正文短于这个字数，基本可以断定没抓到——热点文章几乎都上千字，
 * 抓回来两百来字的，实测全是页面外壳（导航、点赞按钮的文案、验证页）。
 */
const TOO_SHORT = 250;
/**
 * 一个真段落的下限。
 *
 * 量过库里 1390 份真实文档：**最长行的中位数是 267 字**，p5 是 40。
 * 而「最长行」最短的那几份恰恰是扉页、目录、书名页——它们本身就是导航性质的，
 * 被这道闸拦下正是对的。60 落在 p1(18) 和 p10(95) 之间，够宽也够紧。
 */
const PARAGRAPH_MIN = 60;

export function looksBlocked(text) {
  const body = text.replace(/\s/g, "");
  return body.length < TOO_SHORT && WALL_WORDS.test(text);
}

/**
 * 抓回来的这份东西算不算正文，不算的话原因是什么（空字符串 = 算）。
 *
 * **两条路共用同一套门槛。** Readability 直取和 Firecrawl 各写各的检查，就会像这次一样：
 * 直取那条卡 80 字，Firecrawl 那条也卡 80 字，于是公众号回的 200 字页面 UI 文案
 * （「Weixin Official Accounts Platform」+「轻点两下取消赞」）两条都过，
 * 界面上渲染出一篇由按钮文案拼成的「正文」。补一处漏一处，而用户看到的是同一屏垃圾。
 */
/**
 * 内联的 `data:` 图片一律去掉。
 *
 * ⚠️ **它们不只是没用，还会骗过长度检查。** 站点的导航壳里塞着几十个 base64 编码的
 * SVG 图标，一个就上千字符——实测某站抓回来 9309 字符，其中几乎全是 base64，
 * 而正文一个字都没有。`junkReason` 按字符数判断，于是这坨壳大摇大摆过了闸门，
 * 存进知识库变成一篇「正文」。
 *
 * 它们也取不回来、撑爆 SQLite 和全文索引。落地之前就该消失。
 */
export function stripInlineData(markdown) {
  return String(markdown || "")
    .replace(/!\[[^\]]*\]\(\s*data:[^)]*\)/g, "")
    .replace(/\[[^\]]*\]\(\s*data:[^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 真正的正文有多少字：图片、链接地址和代码围栏标记都不算。 */
function proseLength(markdown) {
  return String(markdown || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}/g, "")
    .replace(/\s/g, "")
    .length;
}

/**
 * 最长的一行有多少字。**这是判断「是正文还是导航」最可靠的一个信号。**
 *
 * ⚠️ 别再靠特征词认垃圾了，那是追不完的（这个文件上面就是这么说的）。
 * 导航壳和正文的差别是**结构性**的：菜单是几十行「Get started」「Video generation」，
 * 每行一两个词；而任何真正的段落都会超过 60 字。实测某站抓回来 677 字的
 * 纯菜单，字数检查照过不误——因为它确实有 677 个字，只是没有一行是句子。
 */
function longestLineLength(markdown) {
  return String(markdown || "")
    .split(/\n+/)
    .map((line) => line.replace(/^[#>\-*\d.\s]+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim())
    .reduce((longest, line) => Math.max(longest, line.length), 0);
}

/**
 * 一行里有多少字是躺在链接里的。导航是「一行一个链接」，正文是「一段话里偶尔一个链接」。
 */
function linkShare(line) {
  const visible = String(line).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^[#>\-*\d.\s]+/, "").trim();
  if (!visible.length) return 1;
  const inLinks = [...String(line).matchAll(/\[([^\]]*)\]\([^)]*\)/g)].reduce((sum, match) => sum + match[1].length, 0);
  return inLinks / visible.length;
}

/**
 * 去掉导航行。
 *
 * ⚠️ **要全文逐行删，不能只掐头去尾。** 上一版是「留下第一个成段的行到最后一个之间」，
 * 对这个站点完全无效：侧栏导航树被拍平之后是**穿插在正文里**的，而且首行是一句
 * 89 字的促销 banner，够长，于是一行都没被掐掉。
 *
 * 判据是**链接占比**，不是关键词：导航行的字几乎全躺在链接里，正文行不会。
 * 图片-only 的行（站点图标、被抽走的 base64 占位）同理。
 */
export function stripNavigationLines(markdown) {
  const kept = String(markdown || "").split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    const bare = trimmed.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^[#>\-*\d.\s]+/, "").trim();
    if (!bare) return false;                      // 只剩图片或空链接
    if (linkShare(trimmed) >= 0.8) return false;  // 几乎整行都是链接文字
    return true;
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 用**页面自己的标题**定正文起点。
 *
 * ⚠️ 到这一步之前已经试过六种办法：`onlyMainContent`、`excludeTags`、剥 data URI、
 * 结构性垃圾判据、掐头去尾、按链接占比逐行删。对 BytePlus 这类 SPA 文档站全都不够——
 * 它既不用 `<nav>` 语义标签，导航项又是不带链接的纯文字，形状上和小标题一模一样。
 *
 * 再加一条形状规则只会继续这个循环。换一个**不靠猜的锚点**：页面标题。
 * 正文从「标题重复出现的那一行」开始，这是页面自己给的信息，不是我总结的规律。
 * 找不到标题就原样返回——宁可留着噪音，也不要切掉真正文。
 */
function trimToTitle(markdown, title) {
  // ⚠️ **反过来判断：正文里那一行是标题的前缀**，而不是从标题里切出主段。
  // 站点的 <title> 分隔符五花八门（`|` `--` `–` `·` `::`），猜分隔符要么漏要么切错；
  // 而「Dreamina Seedance 2.5 prompt guide」一定是
  // 「Dreamina Seedance 2.5 prompt guide--ModelArk-Byteplus」的前缀。
  const key = String(title || "").replace(/\s+/g, "").trim();
  if (key.length < 8) return markdown;
  const lines = String(markdown || "").split("\n");
  const at = lines.findIndex((line) => {
    const bare = line.replace(/^[#>\-*\d.\s]+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, "").trim();
    return bare.length >= 8 && key.startsWith(bare);
  });
  return at <= 0 ? markdown : lines.slice(at).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function junkReason(markdown) {
  if (looksBlocked(markdown)) return "抓回来的是验证页，不是正文";
  // ⚠️ 按**正文字数**判断，不是按字符数：图片地址和 base64 都不是正文。
  if (proseLength(markdown) < TOO_SHORT) return "抓回来的正文太短，多半没抓对";
  // 一行成段的都没有 → 这是目录或导航。误判的代价只是多跑一次 Firecrawl，
  // 而漏判的代价是一篇菜单被当成正文存进知识库。
  if (longestLineLength(markdown) < PARAGRAPH_MIN) return "抓回来的像是导航或目录，没有成段的正文";
  return "";
}

/**
 * **Firecrawl 兜底**：真跑一个浏览器把 JS 渲染出来，再要 Markdown。
 *
 * 为什么需要它：Readability 只能看服务端吐回来的 HTML，而公众号、知乎这类站点对
 * 非浏览器客户端只给一个空壳——正文根本不在那份 HTML 里，怎么解析都解析不出来。
 * 这不是提取算法的问题，是「没有浏览器」的问题，只能用浏览器补。
 *
 * **默认不开。** 配了 key（云端）或 base（自托管）才走这条路，而且**只在 Readability
 * 失败之后才走**——它慢一个数量级（要等页面渲染完），还要花额度，能直接解析的没必要绕。
 *
 * `.env` 里二选一：
 *   FIRECRAWL_API_KEY=fc-xxx                     # 云端（firecrawl.dev 注册拿）
 *   FIRECRAWL_BASE_URL=http://127.0.0.1:3002     # 自托管（AGPL-3.0，docker compose up）
 */
async function viaFirecrawl(env, url) {
  const key = (env.FIRECRAWL_API_KEY || "").trim();
  const base = (env.FIRECRAWL_BASE_URL || "").trim().replace(/\/+$/, "") || "https://api.firecrawl.dev";
  // 自托管默认不设鉴权，所以「有 key」和「有自建地址」任意一个成立就算配过了
  if (!key && !env.FIRECRAWL_BASE_URL) return null;

  const res = await proxyFetch(`${base}/v2/scrape`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    // onlyMainContent 让它自己做正文提取；直接要 markdown，省掉我们再转一道
    /**
     * ⚠️ **`onlyMainContent` 一个人不够。** 实测 BytePlus 文档站（SPA，整个应用一个 div）
     * 它照样把整棵侧栏导航树拍平进 markdown——1047 行里 787 行是导航。
     * `excludeTags` 是**语义**判据（按 HTML 标签删），比事后猜哪行是菜单可靠得多。
     */
    body: JSON.stringify({
      url, formats: ["markdown"], onlyMainContent: true, timeout: 45000,
      excludeTags: ["nav", "header", "footer", "aside", "script", "style", "noscript", "form"],
    }),
    signal: AbortSignal.timeout(60000),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw err(
      `Firecrawl 也没读到：${data?.error || `HTTP ${res.status}`}`,
      res.status === 401 || res.status === 402
        ? "检查 .env 里的 FIRECRAWL_API_KEY，或者额度用完了"
        : "这个站点连真浏览器都挡，只能开原网页看"
    );
  }
  // 和直取那条走**同一套**门槛：Firecrawl 说 success 只代表它跑完了页面，
  // 不代表拿到的是正文——公众号连真浏览器都挡，它回的照样是一份外壳
  // Firecrawl 也会把内联 base64 图片原样带回来，同样清掉。
  const cleaned = stripNavigationLines(stripInlineData(data.data?.markdown));
  const markdown = trimToTitle(cleaned, data.data?.metadata?.title);
  if (junkReason(markdown)) return null;

  const meta = data.data?.metadata || {};
  return {
    title: (meta.title || "").trim(),
    byline: (meta.author || "").trim(),
    siteName: (meta.ogSiteName || meta.siteName || hostOf(url)).trim(),
    url,
    markdown,
    words: proseLength(markdown),
    via: "firecrawl",
  };
}

const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

export async function readArticle(url, env = {}) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw err("这不是一个合法的网址", "回热点列表点「打开原文」看看链接对不对", 400);
  }
  // 只放行 http(s)：这个端点会拿服务端的身份去请求，file:// 之类不能碰
  if (!/^https?:$/.test(target.protocol)) {
    throw err("只支持 http/https 链接", "", 400);
  }

  /**
   * 抓不动就交给 Firecrawl（配了才有）。**顺序不能反**：先试直取 + Readability，
   * 那条路快一个数量级又不花额度；Firecrawl 是「这页非得有浏览器才行」时的兜底。
   */
  const fallback = async (e) => {
    const alt = await viaFirecrawl(env, target.href).catch((fe) => {
      throw fe.status ? fe : e; // Firecrawl 自己的错更具体就报它的，否则报原来那个
    });
    if (alt) return alt;
    throw e;
  };

  /**
   * **已知要浏览器才读得出正文的站点，直接分流**，不先解析一遍再看结果好不好。
   *
   * `whyNot` 里点名的那几个域名，我们早就知道它们对非浏览器客户端只回一个壳——
   * 「这不是提取算法的问题，是没有浏览器的问题」。可 Readability 面对那个壳并不会失败：
   * 它会尽职地把壳里的字提取出来交差，而那些字是什么完全看运气。实测两种都见过：
   *   · 一整张验证页（「安全验证 / 请拖动物体完成验证 / 我不会 / 换一组」，139 字）
   *   · 页面 UI 文案（标题「Weixin Official Accounts Platform」+「轻点两下取消赞」，200 字）
   * 两次都越过了「太短」的门槛，于是界面上渲染出一篇由界面文案拼成的「正文」。
   *
   * 靠特征词去认这些垃圾是**追不完的**——每换一种壳就要补一条规则，而补漏的代价由用户
   * 先承担一次。既然域名这一层是确定的，就在这里断掉：配了 Firecrawl 就直接交给它
   * （本来也只有浏览器读得了），没配就直接给 `whyNot` 的引导。顺带还省掉一次白跑的请求。
   */
  if (needsBrowser(target.hostname)) {
    return fallback(err("这个站点要真浏览器才渲染得出正文", whyNot(target.hostname, env)));
  }

  let res;
  try {
    res = await proxyFetch(target.href, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
  } catch (e) {
    return fallback(err(`打不开这个网页：${e.message}`, "多半是网络或代理的问题，可以直接开原网页看"));
  }
  if (!res.ok) {
    return fallback(
      err(`网页返回 ${res.status}`, res.status === 403 || res.status === 429 ? "这个站点挡住了抓取，直接开原网页看吧" : "")
    );
  }
  const type = res.headers.get("content-type") || "";
  if (!/html/i.test(type)) {
    throw err("这个地址给回来的不是网页", `内容类型是 ${type.split(";")[0] || "未知"}，直接开原网页看吧`);
  }

  const html = await res.text();
  // linkedom 只做解析，不跑脚本、不发请求——拿一个 DOM 给 Readability 用而已
  const { document } = parseHTML(html);
  // 相对链接和图片要能还原成绝对地址，否则正文里的图全是坏的
  if (!document.querySelector("base")) {
    const base = document.createElement("base");
    base.setAttribute("href", target.href);
    document.head?.appendChild(base);
  }

  const readerable = isProbablyReaderable(document);
  const article = new Readability(document, { charThreshold: 200 }).parse();
  if (!article?.content) {
    return fallback(err(readerable ? "正文提取失败" : "这个页面没有可提取的正文", whyNot(target.hostname, env)));
  }

  /**
   * 图片保持**绝对地址**：这篇文章不落 vault，没有本地图片目录可指。
   * （`xhtmlToMd` 的第二个参数是必传的——epub 那边靠它把 zip 里的图映射到本地文件名；
   * 不传就是 `resolveImage is not a function`，整篇文章跟着一起挂掉。冒烟测试抓到过。）
   */
  const toAbsolute = (src) => {
    try {
      return new URL(src, target.href).href;
    } catch {
      return "";
    }
  };
  const markdown = trimToTitle(stripNavigationLines(stripInlineData(xhtmlToMd(article.content, toAbsolute))), article.title);
  const junk = junkReason(markdown);
  if (junk) return fallback(err(junk, whyNot(target.hostname, env)));

  return {
    title: (article.title || "").trim(),
    byline: (article.byline || "").trim(),
    siteName: (article.siteName || target.hostname).trim(),
    url: target.href,
    markdown,
    // ⚠️ 按**清洗后的正文**算，不按 `textContent`：后者含导航壳和图标文案，
    // 报出来的字数会比真正存进去的多出好几倍。
    words: proseLength(markdown),
  };
}
