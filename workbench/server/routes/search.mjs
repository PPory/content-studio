// /api/search —— 全局检索。一个入口找遍 vault、Notion 四库和已发布作品。

import { json, fail } from "../lib/http.mjs";
import { searchAll } from "../lib/search.mjs";

export const searchRoutes = [
  {
    method: "GET",
    path: "/api/search",
    async handler({ env, res, url }) {
      try {
        const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
        json(res, await searchAll(env, q, { limit: Number(url.searchParams.get("limit")) || 40 }));
      } catch (e) {
        fail(res, e.message, { hint: e.hint });
      }
    },
  },
];
