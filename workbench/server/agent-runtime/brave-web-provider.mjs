import { WebError } from "@deepseek-ai/dsh-web";

export const name = "xenho-brave-web-provider";
export const inject = ["web"];

function abortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function apply(ctx) {
  const apiKey = String(process.env.BRAVE_SEARCH_API_KEY || "").trim();
  ctx.web.registerSearchProvider({
    id: "brave",
    available: () => Boolean(apiKey),
    async search(request, signal) {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", String(request.query || "").slice(0, 300));
      url.searchParams.set("count", String(Math.max(1, Math.min(20, Number(request.maxResults) || 8))));
      url.searchParams.set("search_lang", "zh-hans");
      let response;
      try {
        response = await fetch(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
          signal,
        });
      } catch (error) {
        if (abortError(error)) throw new WebError("Brave search aborted", "WEB_ABORTED", { cause: error });
        throw new WebError(`Brave search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
      }
      if (!response.ok) throw new WebError(`Brave Search 返回 HTTP ${response.status}`, "WEB_PROVIDER_ERROR");
      try {
        const data = await response.json();
        return {
          sources: (data.web?.results || []).map((item) => ({
            url: String(item.url || ""),
            ...(item.title ? { title: String(item.title) } : {}),
            ...(item.description ? { snippet: String(item.description).slice(0, 1_000) } : {}),
            ...(item.page_age || item.age ? { publishedAt: String(item.page_age || item.age) } : {}),
          })).filter((item) => item.url),
          truncated: false,
        };
      } catch (error) {
        if (abortError(error)) throw new WebError("Brave search aborted", "WEB_ABORTED", { cause: error });
        throw new WebError(`Brave Search 返回了无法解析的数据：${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
      }
    },
  });
}
