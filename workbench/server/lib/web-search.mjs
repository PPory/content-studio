// 公开网页检索。工作台只认一个出口，供应商在这里挑。
//
// ⚠️ **为什么要不止一个供应商。** Brave 是通用网页索引，按关键词匹配；找一篇
// 「某模型的官方提示词教程」时，它给回来的常常是博客、聚合站和二手转述，
// 官方文档排在后面甚至不在前十。Tavily 是给检索增强场景做的：它按问题意图排序，
// 而且**每条结果直接带正文摘录**——对「先判断这份资料值不值得收」这件事，
// 一段真实正文比一句 meta description 有用得多。
//
// 选择顺序：显式指定 > 有 Tavily 密钥就用 Tavily > 回落 Brave。
// 不做「同时打两家再合并」：那会让一次搜索花两份钱和两倍时间，而这里要的是
// 一个够好的入口，不是全网召回。

import { proxyFetch } from "./fetch.mjs";

const clean = (value, max) => String(value ?? "").trim().slice(0, max);

export function searchProvider(env = {}) {
  const explicit = clean(env.AGENT_SEARCH_PROVIDER, 40).toLowerCase();
  if (explicit === "tavily" || explicit === "brave") return explicit;
  return clean(env.TAVILY_API_KEY, 200) ? "tavily" : "brave";
}

async function searchTavily(env, query, maxResults, signal) {
  const key = clean(env.TAVILY_API_KEY, 200);
  if (!key) throw Object.assign(new Error("Tavily 尚未配置"), { status: 400, hint: "在设置中填写 Tavily 密钥，或把检索供应商切回 Brave。" });
  const response = await proxyFetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    // advanced 会多读一层页面正文再排序。这里的取舍是**质量优先**：
    // 收进知识库的资料要长期被引用，选错一份的代价远大于多等两秒。
    body: JSON.stringify({ query, max_results: maxResults, search_depth: "advanced", include_answer: false }),
    signal,
  });
  if (!response.ok) throw new Error(`Tavily 返回 HTTP ${response.status}`);
  const data = await response.json();
  return (data.results || []).map((item) => ({
    url: clean(item.url, 2_000),
    title: clean(item.title, 500),
    // ⚠️ 这里是**正文摘录**，不是 meta description。模型据此判断值不值得收，
    // 差别很大：description 常常是站点通用标语，正文摘录才透露这页到底讲了什么。
    snippet: clean(item.content, 1_200),
    publishedAt: clean(item.published_date, 100),
    score: typeof item.score === "number" ? Number(item.score.toFixed(3)) : null,
  })).filter((item) => item.url);
}

async function searchBrave(env, query, maxResults, signal) {
  const key = clean(env.BRAVE_SEARCH_API_KEY, 4_000);
  if (!key) throw Object.assign(new Error("联网搜索尚未配置"), { status: 400, hint: "在设置中填写 Brave Search 或 Tavily 密钥。" });
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));
  url.searchParams.set("search_lang", "zh-hans");
  const response = await proxyFetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": key }, signal });
  if (!response.ok) throw new Error(`Brave Search 返回 HTTP ${response.status}`);
  const data = await response.json();
  return (data.web?.results || []).map((item) => ({
    url: clean(item.url, 2_000),
    title: clean(item.title, 500),
    snippet: clean(item.description, 1_200),
    publishedAt: clean(item.page_age || item.age, 100),
    score: null,
  })).filter((item) => item.url);
}

/**
 * 搜一次公开网页。
 *
 * ⚠️ **主供应商失败时回落到另一家，而且要报出实际用的是谁。**
 * 静默回落会让「为什么这次结果这么差」永远查不出来——用户以为在用 Tavily，
 * 其实那次是 Brave 顶上的。
 */
export async function searchWeb(env, { query, maxResults = 8, signal } = {}) {
  const term = clean(query, 300);
  if (!term) throw new Error("搜索词不能为空");
  const take = Math.max(1, Math.min(10, Number(maxResults) || 8));
  const primary = searchProvider(env);
  const run = (name) => (name === "tavily" ? searchTavily : searchBrave)(env, term, take, signal);
  try {
    return { provider: primary, query: term, sources: (await run(primary)).slice(0, take) };
  } catch (error) {
    const backup = primary === "tavily" ? "brave" : "tavily";
    const hasBackup = backup === "tavily" ? clean(env.TAVILY_API_KEY, 200) : clean(env.BRAVE_SEARCH_API_KEY, 4_000);
    if (!hasBackup) throw error;
    return { provider: backup, fellBackFrom: primary, reason: clean(error.message, 200), query: term, sources: (await run(backup)).slice(0, take) };
  }
}
