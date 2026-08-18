// /api/archive → 流水线稿件库「已发布」→ vault Markdown 单向归档。
//
// 红线：**单向、只增不改**。已经导出过的文件绝不覆盖——你可能在 Obsidian 里
// 给归档稿加过批注或改过错别字，重跑一次就没了。双向同步是明确禁止的（见 design.md）。

import { json, fail } from "../lib/http.mjs";
import { callWorker } from "../lib/worker.mjs";
import { vaultRoot, writeVaultFile, fileExists } from "../lib/vault.mjs";
import { ARCHIVE_WORKS } from "../lib/vault-dirs.mjs";

const DIR = ARCHIVE_WORKS;

// 导出是为了能单独测：稿件库暂时没有「已发布」的稿子时，端到端跑不出文件，
// 但文件名清洗这块出错的代价很大（Windows 上非法字符会直接写失败），必须单测。
// Windows 文件名非法字符 + 换行，统一替换掉；再截短避免路径过长
export function safeName(s) {
  return String(s || "无标题")
    .replace(/[\\/:*?"<>|\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "无标题";
}

function dateOf(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const archiveRoutes = [
  {
    method: "POST",
    path: "/api/archive/run",
    async handler({ env, res }) {
      try {
        const root = vaultRoot(env);
        const search = new URLSearchParams({ state: "已发布", pageSize: "50" }).toString();
        const list = await callWorker(env, "list/drafts", { search });
        if (!list.data?.ok) return json(res, list.data, list.status);

        const written = [];
        const skipped = [];
        for (const item of list.data.items) {
          const rel = `${DIR}/${safeName(item.platform || "其他")}/${dateOf(item.editedAt)}-${safeName(item.title)}.md`;
          if (await fileExists(root, rel)) {
            skipped.push(item.title);
            continue;
          }
          // 正文按需取：列表只带摘要，全文在页面块里
          const page = await callWorker(env, `page/${item.id}`);
          const body = page.data?.ok ? page.data.text : "";

          const front = [
            "---",
            `标题: ${item.title}`,
            `平台: ${item.platform || ""}`,
            `发布状态: ${item.status || ""}`,
            `归档于: ${new Date().toISOString().slice(0, 10)}`,
            "---",
            "",
          ].join("\n");
          const summary = item.note ? `> ${item.note}\n\n` : "";
          await writeVaultFile(root, rel, `${front}${summary}${body}\n`);
          written.push(rel);
        }

        json(res, {
          ok: true,
          dir: DIR,
          written,
          skipped: skipped.length,
          total: list.data.items.length,
        });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
];
