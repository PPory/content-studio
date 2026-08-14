// npm run check —— 不开浏览器就能回答「现在配到哪一步了、还差什么」。
// 每条检查失败时都要给出具体的下一步命令，而不只是 FAIL。

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "vite";
import { safeJoin, listDir } from "../server/lib/vault.mjs";
import { proxyFetch } from "../server/lib/fetch.mjs";

const env = loadEnv("development", process.cwd(), "");
const results = [];

function ok(name, detail) { results.push({ level: "ok", name, detail }); }
function warn(name, detail) { results.push({ level: "warn", name, detail }); }
function bad(name, detail) { results.push({ level: "bad", name, detail }); }

// 1. vault
const root = (env.VAULT_ROOT || "").trim();
if (!root) {
  bad("vault 路径", "在 .env 里填 VAULT_ROOT");
} else if (!fs.existsSync(root)) {
  bad("vault 路径", `${root} 不存在，检查 .env 里的 VAULT_ROOT`);
} else {
  const abs = path.resolve(root);
  const items = await listDir(abs, "");
  ok("vault 路径", `${abs}（顶层 ${items.length} 项，vault 名 ${path.basename(abs)}）`);
}

// 2. 目录穿越必须被挡住。这条挂了就是任意文件读取漏洞，不是「不方便」。
if (root && fs.existsSync(root)) {
  const attacks = ["../../../Windows/win.ini", "C:/Windows/win.ini", "..\\..\\secret.md"];
  const escaped = attacks.filter((a) => {
    try { safeJoin(path.resolve(root), a); return true; } catch { return false; }
  });
  if (escaped.length) bad("路径越界防护", `这些路径没被拦住：${escaped.join(", ")}`);
  else ok("路径越界防护", `${attacks.length} 个越界样例全部拦下`);
}

// 3. Worker
const workerUrl = (env.WORKER_URL || "").trim().replace(/\/+$/, "");
const key = (env.WORKBENCH_KEY || "").trim();
if (!workerUrl || !key) {
  warn("流水线连接", "未配置 WORKER_URL / WORKBENCH_KEY，工作台会显示引导页。配好前四个库的数据看不到");
} else {
  try {
    const res = await proxyFetch(`${workerUrl}/wb/ping`, { headers: { "X-Workbench-Key": key } });
    const data = await res.json().catch(() => null);
    if (data?.ok) ok("流水线连接", `${workerUrl} 可达`);
    else if (res.status === 403) bad("流水线连接", "密钥不匹配：.env 里的 WORKBENCH_KEY 和 wrangler secret 得是同一串");
    else if (res.status === 503) bad("流水线连接", "Worker 没配 WORKBENCH_KEY，跑 npx wrangler secret put WORKBENCH_KEY");
    else bad("流水线连接", `HTTP ${res.status}${data?.error ? `：${data.error}` : "，可能是还没部署带 /wb 端点的版本"}`);
  } catch (e) {
    bad("流水线连接", `连不上：${e.message}`);
  }
}

const icon = { ok: "✓", warn: "!", bad: "✗" };
console.log("");
for (const r of results) console.log(` ${icon[r.level]} ${r.name.padEnd(12, "　")} ${r.detail}`);
console.log("");

if (results.some((r) => r.level === "bad")) process.exit(1);
