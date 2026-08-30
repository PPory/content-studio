import fs from "node:fs/promises";
import { mediacrawlerDir } from "./settings-schema.mjs";
import { typesetDir } from "../routes/tools.mjs";
import { piRuntimeInfo } from "../agent-runtime/pi-runtime.mjs";
import { probeSixty, sixtyConfigured } from "./sixty.mjs";
import { resolveWorkspacePaths } from "../storage/workspace-paths.mjs";

const result = (id, label, status, text, hint = "") => ({ id, label, status, text, ...(hint ? { hint } : {}) });

async function isDirectory(abs) {
  try {
    return (await fs.stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

async function checkWorkspace(env) {
  let paths;
  try {
    paths = resolveWorkspacePaths({ env });
  } catch (error) {
    return result("workspace", "本地工作区", "bad", error.message, "填写磁盘根目录以外的绝对路径");
  }
  if (!(await isDirectory(paths.root))) {
    return result("workspace", "本地工作区", "warn", "目录尚不存在", `工作台重启后会创建：${paths.root}`);
  }
  if (!(await isDirectory(paths.workspaceDir))) {
    return result("workspace", "本地工作区", "warn", "根目录存在，Workspace 尚未初始化", "重启工作台后会完成初始化");
  }
  return result("workspace", "本地工作区", "ok", "SQLite 工作区目录可用");
}

function checkDeepl(env) {
  const key = String(env.DEEPL_API_KEY || "").trim();
  if (!key) return result("deepl", "划词翻译", "off", "没配", "可选；填写 DeepL 密钥后启用");
  return result("deepl", "划词翻译", "ok", key.endsWith(":fx") ? "已配免费版" : "已配 Pro 版");
}

function checkFirecrawl(env) {
  const key = String(env.FIRECRAWL_API_KEY || "").trim();
  const base = String(env.FIRECRAWL_BASE_URL || "").trim();
  if (!key && !base) return result("firecrawl", "网页正文兜底", "off", "没配", "可选；直读失败时仍可打开原网页");
  return result("firecrawl", "网页正文兜底", "ok", base ? "已配自托管地址" : "已配官方服务");
}

async function checkSixty(env) {
  if (!sixtyConfigured(env)) return result("sixty", "平台热榜", "off", "没配数据源地址", "可选；不影响本地内容与 AI");
  const probe = await probeSixty(env);
  if (!probe.ok) return result("sixty", "平台热榜", "bad", `地址已填但读不到：${probe.reason || probe.error}`, "检查实例地址和本机网络");
  return result("sixty", "平台热榜", "ok", "连通");
}

async function checkAgentRuntime(env) {
  const info = await piRuntimeInfo(env);
  if (!info.available) return result("agent", "AI 对话", "bad", "Pi SDK 版本检查未通过", info.reason || "重新安装工作台依赖");
  if (!info.configured) return result("agent", "AI 对话", "off", "Pi 已就绪，模型尚未配置", "填写模型地址、模型 ID 和密钥");
  return result("agent", "AI 对话", "ok", `Pi Agent SDK ${info.version} 已就绪`);
}

async function checkTypeset(env) {
  return (await isDirectory(typesetDir(env)))
    ? result("typeset", "排版工具", "ok", "目录可用")
    : result("typeset", "排版工具", "off", "未找到", "可选；填写 wechat-typeset 的绝对路径");
}

async function checkMediacrawler(env) {
  return (await isDirectory(mediacrawlerDir(env)))
    ? result("mediacrawler", "站内探针", "ok", "目录可用")
    : result("mediacrawler", "站内探针", "off", "未安装", "可选；不影响本地创作主流程");
}

export async function runChecks(env) {
  const checks = [checkWorkspace, checkAgentRuntime, checkDeepl, checkFirecrawl, checkSixty, checkTypeset, checkMediacrawler];
  return Promise.all(checks.map(async (check) => {
    try {
      return await check(env);
    } catch (error) {
      return result(check.name, check.name, "warn", `这一项没检成：${error.message}`, "不影响保存，稍后可重新检查");
    }
  }));
}
