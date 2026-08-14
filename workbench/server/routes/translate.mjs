// /api/translate → 划词翻译，走 DeepL。
//
// **key 只在服务端**（`.env` 的 `DEEPL_API_KEY`），前端一行密钥都没有——和 Worker、
// LLM 那两条链路同一条规矩。
//
// 为什么是 DeepL 不是免费的 Google：中文长句上 DeepL 明显更通顺，而用户手里本来就有 key。
// 没配 key 的时候**给引导不是报错**——照本项目的错误契约，`hint` 里写清楚下一步做什么。
//
// 不做整页翻译、不做「显示原文对照」那套：那是阅读器的形态。这里的翻译是划词动作之一，
// 结果落在右栏，和「解释 / 展开 / 反驳」并排——你划一句看不懂的英文，右边告诉你它说什么。

import { json, fail, readJsonBody } from "../lib/http.mjs";
import { proxyFetch } from "../lib/fetch.mjs";

// 免费版和 Pro 版是两个域名，key 以 `:fx` 结尾的是免费版。这是 DeepL 自己的约定，
// 拿 Pro 的地址打免费 key 会回 403，报错里还看不出是这个原因。
function endpointFor(key) {
  return key.trim().endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";
}

export const translateRoutes = [
  {
    method: "POST",
    path: "/api/translate",
    async handler({ env, req, res }) {
      const key = (env.DEEPL_API_KEY || "").trim();
      if (!key) {
        return fail(res, "还没配翻译服务", {
          status: 503,
          hint: "在 creator-workbench/.env 里加一行 DEEPL_API_KEY=你的密钥（免费版的 key 以 :fx 结尾），然后重启 npm run dev",
        });
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return fail(res, e.message, { status: 400 });
      }
      const text = String(body?.text || "").trim();
      if (!text) return fail(res, "没有要翻译的内容", { status: 400 });

      // 目标语言默认中文。DeepL 的中文代码是 ZH，不是 zh-CN
      const target = String(body?.target || "ZH").toUpperCase();

      try {
        const r = await proxyFetch(endpointFor(key), {
          method: "POST",
          headers: {
            Authorization: `DeepL-Auth-Key ${key}`,
            "content-type": "application/json",
          },
          // 一次只翻一段：划词翻译的输入本来就是一小段，批量接口在这儿没意义
          body: JSON.stringify({ text: [text.slice(0, 5000)], target_lang: target }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          // DeepL 的报错码要翻成人话，原样铺出去用户看不懂该干什么
          const why =
            r.status === 403 ? "密钥不对，或者用错了版本（免费版的 key 以 :fx 结尾）"
            : r.status === 456 ? "本月免费额度用完了"
            : r.status === 429 ? "请求太频繁，等几秒再试"
            : data?.message || `HTTP ${r.status}`;
          return fail(res, `翻译失败：${why}`, { status: 502, hint: "密钥在 .env 的 DEEPL_API_KEY" });
        }
        const out = data?.translations?.[0];
        json(res, { ok: true, text: out?.text || "", from: out?.detected_source_language || "" });
      } catch (e) {
        fail(res, `连不上 DeepL：${e.message}`, { status: 502, hint: "检查网络和代理" });
      }
    },
  },
];
