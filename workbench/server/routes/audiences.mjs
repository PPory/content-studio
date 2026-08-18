// /api/audiences → 「目标读者」的预设清单。真源在 `server/lib/audiences.mjs`。
//
// 只有两个动作：读全部、记一条。**没有「删一条」**——清单是用出来的，不是维护出来的；
// 真要清理直接改 `config/audiences.json`（那也是这份配置存成文件而不是 localStorage 的理由之一）。

import { json, fail, readJsonBody } from "../lib/http.mjs";
import { loadAudiences, rememberAudience } from "../lib/audiences.mjs";

export const audienceRoutes = [
  {
    method: "GET",
    path: "/api/audiences",
    async handler({ res }) {
      json(res, { ok: true, items: await loadAudiences() });
    },
  },
  {
    method: "POST",
    path: "/api/audiences",
    async handler({ req, res }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return fail(res, e.message, { status: 400 });
      }
      // 记不下来不该让「新建稿子」跟着失败：这是个锦上添花的副作用，不是主动作
      try {
        const items = await rememberAudience(body?.value);
        json(res, { ok: true, items: items || (await loadAudiences()) });
      } catch (e) {
        console.warn("[audiences] 记不下来:", e.message);
        json(res, { ok: true, items: await loadAudiences() });
      }
    },
  },
];
