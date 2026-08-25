// 能力自检：每条链路现在通不通。
//
// 存在的理由是有一整类问题**现在没有任何地方会说**：
//  - Pi SDK 或模型配置不完整时「对话」无法启动
//  - DeepL 免费版的 key 打 Pro 域名会回 403，而报错里看不出是这个原因
//  - vault 配了、但 `99 - 个人工作台/` 那几个子目录不存在时，界面显示的是
//    「还没建，去导一本」的**空态引导**——看起来像「你还没用过这个功能」，不像出错
//
// 四条规矩：
//  1. **每一条都给「下一步」**，不给原始错误。上游的报错（60s 那种 "Unexpected token '<'"）
//     铺出来既撑爆版面又没人看得懂。
//  2. **可选能力没配 = `off`，不是 `bad`。** 把「你没开这个功能」画成红的，
//     等于每次打开设置面板都在骂人。
//  3. **一条挂了不能带塌其他条**：逐条 try，各失败各的。
//  4. **自检失败不挡保存**——用户可能就是想先填上、晚点再连。

import fs from "node:fs/promises";
import path from "node:path";
import { DIRS } from "./vault-dirs.mjs";
import { callWorker } from "./worker.mjs";
import { mediacrawlerDir, workerDir } from "./settings-schema.mjs";
import { typesetDir } from "../routes/tools.mjs";
import { piRuntimeInfo } from "../agent-runtime/pi-runtime.mjs";
import { probeSixty, sixtyConfigured } from "./sixty.mjs";

// ok=通了 / warn=能用但有话说 / bad=配了却不通 / off=没配（可选能力的正常态）
const R = (id, label, status, text, hint = "") => ({ id, label, status, text, ...(hint ? { hint } : {}) });

const exists = async (abs) => {
  try {
    return (await fs.stat(abs)).isDirectory();
  } catch {
    return false;
  }
};

async function checkVault(env) {
  const root = (env.VAULT_ROOT || "").trim();
  if (!root) return R("vault", "知识库", "bad", "还没填 vault 路径", "书架、洞察、批注、全局检索都要它");
  const abs = path.resolve(root);
  if (!(await exists(abs))) {
    return R("vault", "知识库", "bad", `打不开 ${abs}`, "确认这个目录还在，或者换成 Obsidian 里那个 vault 的绝对路径");
  }
  // 缺子目录**不是错**：第一次用到时工作台自己会建。说清楚免得人以为漏配了什么
  const missing = [];
  for (const rel of Object.values(DIRS)) if (!(await exists(path.join(abs, rel)))) missing.push(rel);
  if (missing.length === Object.values(DIRS).length) {
    return R("vault", "知识库", "warn", "目录在，工作台自己那几个子目录还没建", "第一次导书 / 存批注时会自动建，不用手动创建");
  }
  if (missing.length) {
    return R("vault", "知识库", "ok", `目录在，${Object.values(DIRS).length - missing.length}/${Object.values(DIRS).length} 个子目录已建`, `还没建的：${missing.join("、")}（用到时自动建）`);
  }
  return R("vault", "知识库", "ok", "目录在，工作台的五个子目录都在");
}

async function checkWorker(env) {
  const url = (env.WORKER_URL || "").trim();
  const key = (env.WORKBENCH_KEY || "").trim();
  if (!url && !key) return R("worker", "流水线", "off", "没接", "不接的话「创作」页的四个库是空的，其余功能不受影响");
  if (!url) return R("worker", "流水线", "bad", "填了密钥但没填地址", "把 worker/ 部署出来的 workers.dev 地址填上");
  if (!key) return R("worker", "流水线", "bad", "填了地址但没填密钥", "在 worker/ 目录里跑 npx wrangler secret put WORKBENCH_KEY，把同一串填进来");

  const { status, data } = await callWorker(env, "status");
  // **401 和「连不上」要分开说**：现在界面上这两种长得一模一样，而它们的下一步完全不同
  if (status === 401 || status === 403) {
    return R("worker", "流水线", "bad", "地址通了，密钥不对", "两边要是同一串：这里填的，和 worker/ 里 wrangler secret put 的");
  }
  if (status === 503) return R("worker", "流水线", "bad", data?.error || "连不上", data?.hint || "检查网络和地址");
  if (status === 404) return R("worker", "流水线", "bad", "地址通了，但没有 /wb 端点", "在 worker/ 目录里跑一次 npx wrangler deploy");
  if (status !== 200 || !data?.ok) {
    return R("worker", "流水线", "bad", data?.error || `Worker 回了 HTTP ${status}`, data?.hint || "用 npx wrangler tail 看真实报错");
  }
  const n = Object.values(data.counts || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  return R("worker", "流水线", "ok", `连上了，四个库共 ${n} 条待办`);
}

function checkDeepl(env) {
  const key = (env.DEEPL_API_KEY || "").trim();
  if (!key) return R("deepl", "划词翻译", "off", "没配", "配一个 DeepL key 就有划词翻译；不配的话工具条上不画那个按钮");
  // 域名由 key 自己决定（`routes/translate.mjs` 的 `endpointFor`）。这里把结论说出来，
  // 是因为「拿 Pro 地址打免费 key 会 403 而且报错里看不出原因」这个坑本来只能靠踩
  const free = key.endsWith(":fx");
  return R("deepl", "划词翻译", "ok", free ? "已配（免费版，走 api-free.deepl.com）" : "已配（Pro，走 api.deepl.com）");
}

function checkFirecrawl(env) {
  const key = (env.FIRECRAWL_API_KEY || "").trim();
  const base = (env.FIRECRAWL_BASE_URL || "").trim();
  if (!key && !base) {
    return R("firecrawl", "热点原文兜底", "off", "没配", "公众号 / 知乎这类要真浏览器的页面读不出正文，会给「去原网页看」的出口");
  }
  // 自托管默认不设鉴权，所以「有地址」单独成立（和 `lib/article.mjs` 的 viaFirecrawl 同一条判据）
  return R("firecrawl", "热点原文兜底", "ok", base ? `已配（自托管 ${base}）` : "已配（官方云端）");
}

/**
 * 平台热榜的数据源。
 *
 * 这一条存在的理由和整个自检一样：**不配的表现是「看起来一切正常」**。六个榜全部失败时
 * 热点页退回上一次成功的快照，界面上没有一处红的，只有那行时间戳在慢慢变旧。
 * 没有这枚点的话，唯一的发现方式是自己去读 hot.mjs。
 */
async function checkSixty(env) {
  if (!sixtyConfigured(env)) {
    return R("sixty", "平台热榜", "off", "没配数据源地址", "「热点 → 平台热榜」那六个榜取不到，只会显示上一次成功的快照；另外两个 tab 不受影响");
  }
  const r = await probeSixty(env);
  if (!r.ok) {
    return R("sixty", "平台热榜", "bad", `地址填了，${r.label}读不到（${r.reason || r.error}）`, "浏览器打开这个地址的 /health 看看实例还在不在；workers.dev 在这台机器上还要能走代理");
  }
  return R("sixty", "平台热榜", "ok", "连上了");
}

/** Pi 运行时和模型配置探针。不会发送模型请求，也不会读取或返回密钥。 */
async function checkAgentRuntime(env) {
  const info = await piRuntimeInfo(env);
  if (!info.available) return R("agent", "AI 对话", "bad", "Pi SDK 版本检查未通过", info.reason || "重新安装工作台依赖");
  if (!info.configured) return R("agent", "AI 对话", "off", "Pi 已就绪，模型尚未配置", "填写模型地址、模型 id 和密钥后即可对话");
  return R("agent", "AI 对话", "ok", `Pi Agent SDK ${info.version} 已就绪`);
}

async function checkTypeset(env) {
  const dir = typesetDir(env);
  if (!(await exists(dir))) {
    return R("typeset", "排版工具", "bad", `找不到 ${dir}`, "把 wechat-typeset clone 到工作台的同级目录，或者在上面填它的路径");
  }
  // ok 时**不带目录**：这条自检画在 TYPESET_DIR 字段底下，而那个字段上面
  // 就写着「留空时用：<路径>」——同一个路径说两遍。出错分支照旧要给路径
  return R("typeset", "排版工具", "ok", "找到了");
}

async function checkMediacrawler(env) {
  const dir = mediacrawlerDir(env);
  if (!(await exists(dir))) {
    return R("mediacrawler", "站内探针", "off", "没装 MediaCrawler", "洞察报告会少「小红书 / 抖音站内」这条腿，其余照常");
  }
  return R("mediacrawler", "站内探针", "ok", "找到了");
}

/**
 * worker/ 的本地目录。**只用来找提示词文件**——工作台取数据走的是 Worker 的网络地址，
 * 和这个本地目录无关。所以找不到时是 `off` 不是 `bad`：
 * 少的只是「在设置里改流水线提示词」这一件事，四个库照样能用。
 */
async function checkWorkerDir(env) {
  const dir = workerDir(env);
  if (!(await exists(path.join(dir, "prompt")))) {
    return R("workerdir", "流水线提示词", "off", `没找到 ${dir}/prompt`, "合仓之后它应该就是 workbench 的同级 worker/；不在那儿的话在「本机路径」里填它的位置");
  }
  return R("workerdir", "流水线提示词", "ok", "找到了");
}

/**
 * 全部跑一遍。**逐条 try**：一条抛异常不能把整块自检变成一句「失败」——
 * 那时候用户会以为所有配置都错了。
 */
export async function runChecks(env) {
  const jobs = [checkVault, checkWorker, checkDeepl, checkFirecrawl, checkSixty, checkAgentRuntime, checkTypeset, checkMediacrawler, checkWorkerDir];
  return Promise.all(
    jobs.map(async (fn) => {
      try {
        return await fn(env);
      } catch (e) {
        return R(fn.name, fn.name, "warn", `这一项没检成：${e.message}`, "不影响保存，稍后再点一次「重新检查」");
      }
    })
  );
}
