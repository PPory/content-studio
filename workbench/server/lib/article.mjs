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
function junkReason(markdown) {
  if (looksBlocked(markdown)) return "抓回来的是验证页，不是正文";
  if (markdown.replace(/\s/g, "").length < TOO_SHORT) return "抓回来的正文太短，多半没抓对";
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
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 45000 }),
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
  const markdown = String(data.data?.markdown || "").trim();
  if (junkReason(markdown)) return null;

  const meta = data.data?.metadata || {};
  return {
    title: (meta.title || "").trim(),
    byline: (meta.author || "").trim(),
    siteName: (meta.ogSiteName || meta.siteName || hostOf(url)).trim(),
    url,
    markdown,
    words: markdown.replace(/\s/g, "").length,
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
  const markdown = xhtmlToMd(article.content, toAbsolute).trim();
  const junk = junkReason(markdown);
  if (junk) return fallback(err(junk, whyNot(target.hostname, env)));

  return {
    title: (article.title || "").trim(),
    byline: (article.byline || "").trim(),
    siteName: (article.siteName || target.hostname).trim(),
    url: target.href,
    markdown,
    // 中文按字数算，`textContent` 里全角空格和换行不算字
    words: (article.textContent || "").replace(/\s/g, "").length,
  };
}
