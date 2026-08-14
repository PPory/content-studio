// /api/config → 告诉前端「什么配好了、什么没配」，界面据此显示引导而不是空白页。
// 只回布尔和路径，绝不回 key 本身。
//
// **和 `/api/settings` 分开是有意的**：这一条是每页首屏都会拉的轻量端点（App 挂载时一次），
// 而设置面板那条要算默认值、要遍历整份清单。合成一个的话，每次打开工作台都要为一个
// 几周才点一次的面板付一遍代价。
//
// 但**字段名只写一处**：那四个 Notion 链接的中文名来自 `settings-schema.mjs` 的 `label`，
// 不在这里抄第二份——抄了的话，以后在清单里改一个库名，总览页底下那排按钮会安静地
// 变成两套叫法。

import path from "node:path";
import fs from "node:fs";
import { json } from "../lib/http.mjs";
import { SETTINGS } from "../lib/settings-schema.mjs";

const NOTION_LINKS = SETTINGS.filter((f) => f.group === "links" && f.key.startsWith("NOTION_"));

export const configRoutes = [
  {
    method: "GET",
    path: "/api/config",
    async handler({ env, res }) {
      const root = (env.VAULT_ROOT || "").trim();
      const rootAbs = root ? path.resolve(root) : "";
      const vaultExists = rootAbs ? fs.existsSync(rootAbs) : false;

      json(res, {
        ok: true,
        vault: {
          configured: !!root,
          exists: vaultExists,
          root: rootAbs,
          // Obsidian URI 用的 vault 名就是目录名
          name: rootAbs ? path.basename(rootAbs) : "",
        },
        worker: {
          configured: !!(env.WORKER_URL || "").trim() && !!(env.WORKBENCH_KEY || "").trim(),
        },
        links: {
          notion: Object.fromEntries(NOTION_LINKS.map((f) => [f.label, env[f.key] || ""])),
          typeset: env.TYPESET_URL || "",
        },
      });
    },
  },
];
