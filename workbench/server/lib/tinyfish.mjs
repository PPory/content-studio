// TinyFish 搜索与抓取（经 Monid 调度）。
//
// 为什么加这一条通路：中文平台的评论 API 一律打不进去（知乎问题页 403、知乎专栏和
// 小红书只回登录墙），而 Reddit / X / HN 的评论 TinyFish 能带作者和时间完整抓下来。
// 所以这里**只负责英文语境的公开讨论**；中文平台走浏览器扩展那条路（你自己的登录态）。
//
// ⚠️ **这个文件不调模型，也不写库。** 它只把网页上真实存在的文字取回来。
// 判断哪段话算受众问题、要不要留下，都在 domain 层，且必须过逐字校验。

import { proxyFetch } from "./fetch.mjs";

const RUN_ENDPOINT = "https://api.monid.ai/v1/run";
const clean = (value, max = 4_000) => String(value ?? "").trim().slice(0, max);

/** 单次抓取的 URL 上限，TinyFish 侧的硬限制。 */
export const FETCH_URL_LIMIT = 10;

export function monidKey(env) {
  return clean(env?.MONID_API_KEY, 200);
}

export function monidConfigured(env) {
  return Boolean(monidKey(env));
}

/**
 * 这次请求用哪个 fetch。
 *
 * 测试注入 `env.MONID_FETCH`——和领域层的 `*_COMPLETE_JSON` 是同一个约定。
 * 不能靠替换 `globalThis.fetch`：`proxyFetch` 走的是 undici，全局那个替了也拦不住。
 */
function fetchFor(env) {
  return typeof env?.MONID_FETCH === "function" ? env.MONID_FETCH : proxyFetch;
}

async function run(env, { provider, endpoint, input }) {
  const key = monidKey(env);
  if (!key) {
    throw Object.assign(new Error("没有配置 MONID_API_KEY"), {
      status: 503,
      hint: "在 workbench/.env 里加一行 MONID_API_KEY=...（app.monid.ai 生成）。TinyFish 的搜索和抓取本身不计费。",
    });
  }

  let response;
  try {
    response = await fetchFor(env)(RUN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ provider, endpoint, input }),
    });
  } catch (error) {
    // 这台机器上直连常年不通，而全局 fetch 不认 HTTPS_PROXY——报错必须指到网络，
    // 不然读起来像 key 失效，人会跑去看账单页。见 lib/fetch.mjs。
    throw Object.assign(new Error(`连不上 Monid：${error?.cause?.code || error.message}`), {
      status: 502,
      hint: "检查代理是否在跑（HTTPS_PROXY）。这个地址在很多网络下需要代理才通。",
    });
  }

  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`Monid ${provider}${endpoint} 返回 HTTP ${response.status}`), {
      status: response.status === 401 ? 401 : 502,
      hint: clean(text, 300),
    });
  }

  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("Monid 返回的不是 JSON"); }
  if (payload.status && payload.status !== "COMPLETED") {
    throw Object.assign(new Error(`Monid 任务未完成：${payload.status}`), { status: 502, hint: clean(payload.error, 300) });
  }

  /**
   * ⚠️ **计费值要看一眼，不要假设它永远是 0。**
   * TinyFish 现在是 PER_CALL/0，但同一个 `/v1/run` 也能跑按次收费的供应商。
   * 真收了钱而没人发现，是这类聚合层最容易出的事故。
   */
  const charged = Number(payload?.price?.amount?.value || 0);
  return { output: payload.output || {}, charged, runId: clean(payload.runId, 64) };
}

/**
 * 搜索。只回标题、链接和摘要——正文要另外 fetch。
 */
export async function tinyfishSearch(env, { query, purpose = "", includeDomains = "", language = "", location = "", page = 0 } = {}) {
  const q = clean(query, 400);
  if (!q) throw new TypeError("搜索词不能为空");
  const queryParams = { query: q };
  if (purpose) queryParams.purpose = clean(purpose, 2_000);
  if (includeDomains) queryParams.include_domains = clean(includeDomains, 500);
  if (language) queryParams.language = clean(language, 20);
  if (location) queryParams.location = clean(location, 10);
  if (page) queryParams.page = Math.max(0, Math.min(10, Number(page) || 0));

  const { output, charged } = await run(env, { provider: "tinyfish", endpoint: "/search", input: { queryParams } });
  const results = (Array.isArray(output.results) ? output.results : []).map((row) => ({
    url: clean(row.url, 2_000),
    title: clean(row.title, 300),
    siteName: clean(row.site_name || row.siteName, 200),
    snippet: clean(row.snippet, 1_000),
    date: clean(row.date, 60),
  })).filter((row) => row.url);
  return { results, charged };
}

/**
 * 抓正文。
 *
 * ⚠️ **返回的 text 就是要存进证据层的那段话，任何环节都不许改写它。**
 * 证据层的全部价值在于「这句话确实是这么说的」；一旦正文经过模型转述，
 * 后面所有逐字校验都在校验一份二手材料。
 */
export async function tinyfishFetch(env, { urls = [] } = {}) {
  const list = [...new Set(urls.map((item) => clean(item, 2_000)).filter(Boolean))].slice(0, FETCH_URL_LIMIT);
  if (!list.length) throw new TypeError("没有要抓取的链接");

  const { output, charged } = await run(env, {
    provider: "tinyfish", endpoint: "/fetch", input: { body: { urls: list, format: "markdown" } },
  });
  const pages = (Array.isArray(output.results) ? output.results : []).map((row) => ({
    url: clean(row.final_url || row.url, 2_000),
    requestedUrl: clean(row.url, 2_000),
    title: clean(row.title, 300),
    language: clean(row.language, 20),
    text: String(row.text ?? row.markdown ?? ""),
  })).filter((row) => row.url);
  const errors = (Array.isArray(output.errors) ? output.errors : []).map((row) => ({
    url: clean(row.url, 2_000),
    error: clean(row.error, 200),
    status: Number(row.status) || 0,
  }));
  return { pages, errors, charged };
}
