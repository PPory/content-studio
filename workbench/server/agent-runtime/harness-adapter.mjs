import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";

export const HARNESS_VERSION = "0.1.1-rc.2";
export const HARNESS_RESIDENT_IDLE_MS = 15 * 60 * 1_000;
const CONFIG_FILE = fileURLToPath(new URL("./cordis.yml", import.meta.url));
const PROXY_BOOTSTRAP = fileURLToPath(new URL("./proxy-bootstrap.mjs", import.meta.url));
const PROXY_BOOTSTRAP_URL = pathToFileURL(PROXY_BOOTSTRAP).href;
const require = createRequire(import.meta.url);
const PACKAGES = [
  "@deepseek-ai/dsh-sdk-client",
  "@deepseek-ai/dsh-sdk-jsonrpc-demo",
  "@deepseek-ai/dsh-sdk-jsonrpc-server",
  "@deepseek-ai/dsh-agent-spine-demo",
  "@deepseek-ai/dsh-llm-pi-ai",
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/dsh-session-persistence-jsonl",
  "@deepseek-ai/dsh-web",
  "@deepseek-ai/dsh-tool-web",
  "@deepseek-ai/dsh-web-fetch-http",
];
const residentHarnesses = new Map();

const residentKeyOf = (value) => String(value || "").trim().slice(0, 500);

function residentFingerprint(env, runDir, kind, options = {}) {
  return JSON.stringify({
    runDir: path.resolve(runDir),
    kind,
    baseUrl: String(env.HARNESS_LLM_BASE_URL || "").trim(),
    model: String(options.model || env.HARNESS_LLM_MODEL || "").trim(),
    protocol: String(env.HARNESS_LLM_PROTOCOL || "openai-completions").trim(),
    persona: String(options.persona || ""),
    sessionRoot: path.resolve(options.sessionRoot || path.join(runDir, "sessions")),
  });
}

async function closeResidentEntry(key, entry) {
  if (!entry || residentHarnesses.get(key) !== entry) return false;
  residentHarnesses.delete(key);
  if (entry.timer) clearTimeout(entry.timer);
  await entry.harness.close().catch(() => {});
  return true;
}

function scheduleResidentClose(key, entry) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    if (!entry.running) closeResidentEntry(key, entry).catch(() => {});
  }, HARNESS_RESIDENT_IDLE_MS);
  entry.timer.unref?.();
}

export async function closeResidentHarness(residentKey) {
  const key = residentKeyOf(residentKey);
  return key ? closeResidentEntry(key, residentHarnesses.get(key)) : false;
}

export async function closeAllResidentHarnesses() {
  await Promise.all([...residentHarnesses.entries()].map(([key, entry]) => closeResidentEntry(key, entry)));
}

async function installedVersions() {
  return Object.fromEntries(await Promise.all(PACKAGES.map(async (name) => {
    const pkg = JSON.parse(await fs.readFile(require.resolve(`${name}/package.json`), "utf8"));
    return [name, pkg.version];
  })));
}

export async function harnessRuntimeInfo(env = {}) {
  try {
    const versions = await installedVersions();
    const mismatched = Object.entries(versions).filter(([, version]) => version !== HARNESS_VERSION);
    return {
      available: mismatched.length === 0,
      version: HARNESS_VERSION,
      versions,
      configured: !!String(env.HARNESS_LLM_API_KEY || "").trim()
        && !!String(env.HARNESS_LLM_BASE_URL || "").trim()
        && !!String(env.HARNESS_LLM_MODEL || "").trim(),
      reason: mismatched.length ? `Harness 包版本不一致：${mismatched.map(([name, version]) => `${name}@${version}`).join("、")}` : "",
    };
  } catch (error) {
    return { available: false, configured: false, version: HARNESS_VERSION, reason: error.message };
  }
}

export function harnessChildEnv(env, runDir, kind, options = {}) {
  const keep = [
    "SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "PATHEXT", "COMSPEC", "NODE_PATH",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  ];
  const out = Object.fromEntries(keep.map((key) => [key, env[key] || process.env[key]]).filter(([, value]) => value));
  return {
    ...out,
    XENHO_LLM_API_KEY: String(env.HARNESS_LLM_API_KEY || "").trim(),
    XENHO_LLM_BASE_URL: String(env.HARNESS_LLM_BASE_URL || "").trim(),
    XENHO_LLM_MODEL: String(options.model || env.HARNESS_LLM_MODEL || "").trim(),
    XENHO_LLM_PROTOCOL: String(env.HARNESS_LLM_PROTOCOL || "openai-completions").trim(),
    XENHO_LLM_CONTEXT_WINDOW: String(env.HARNESS_LLM_CONTEXT_WINDOW || "131072").trim(),
    XENHO_LLM_MAX_TOKENS: String(env.HARNESS_LLM_MAX_TOKENS || "8192").trim(),
    XENHO_EXPERT_PERSONA: String(options.persona || "你是 Xenho OS 的专业内容顾问。用户是主创。只读研究、保留来源、提交结构化报告；不得修改正文、不得编造经历或证据。"),
    XENHO_CONTEXT_FILE: path.join(runDir, "context.json"),
    XENHO_REPORT_FILE: path.join(runDir, "report.json"),
    XENHO_SESSION_ROOT: options.sessionRoot || path.join(runDir, "sessions"),
    XENHO_EXPERT_KIND: kind,
    BRAVE_SEARCH_API_KEY: String(env.BRAVE_SEARCH_API_KEY || "").trim(),
  };
}

function launchConfig(env, runDir, kind, bin, options = {}) {
  const childEnv = harnessChildEnv(env, runDir, kind, options);
  const usesProxy = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].some((key) => childEnv[key]);
  return {
    args: usesProxy ? ["--import", PROXY_BOOTSTRAP_URL, bin, CONFIG_FILE] : [bin, CONFIG_FILE],
    env: childEnv,
  };
}

export async function createHarnessRun({ env, runDir, kind, prompt, onNotification, onHarness, persona, sessionRoot, sessionId, maxTokens, model, residentKey }) {
  const info = await harnessRuntimeInfo(env);
  if (!info.available) throw Object.assign(new Error(`Harness ${info.version} 兼容检查未通过`), { hint: info.reason });
  if (!info.configured) {
    throw Object.assign(new Error("AI 助手模型尚未配置"), {
      hint: "到 设置 → AI 助手 填写模型地址、模型名和密钥；正文编辑和保存不受影响。",
    });
  }
  const bin = fileURLToPath(import.meta.resolve("@deepseek-ai/dsh-sdk-jsonrpc-demo/bin"));
  const selectedModel = String(model || env.HARNESS_LLM_MODEL || "").trim();
  const launch = launchConfig(env, runDir, kind, bin, { persona, sessionRoot, model: selectedModel });
  const options = { persona, sessionRoot, model: selectedModel };
  const key = residentKeyOf(residentKey);
  const fingerprint = residentFingerprint(env, runDir, kind, options);
  let entry = key ? residentHarnesses.get(key) : null;
  if (entry && entry.fingerprint !== fingerprint) {
    await closeResidentEntry(key, entry);
    entry = null;
  }
  if (!entry) {
    const harness = new DeepSeekHarness({
      launch: {
        command: process.execPath,
        args: launch.args,
        cwd: process.cwd(),
        env: launch.env,
        requestTimeoutMs: 300_000,
      },
      cwd: process.cwd(),
      provider: "xenho",
      model: selectedModel,
      maxTokens: Math.max(1024, Math.min(32768, Number(maxTokens) || Number(env.HARNESS_LLM_MAX_TOKENS) || 8192)),
    });
    entry = { harness, fingerprint, running: 0, timer: null };
    if (key) residentHarnesses.set(key, entry);
  }
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.running += 1;
  onHarness?.(entry.harness, { resident: !!key, residentKey: key });
  try {
    const result = await entry.harness.run(prompt, {
      sessionId: sessionId || `session-${path.basename(runDir).replace(/[^a-z0-9-]/gi, "")}`,
      onNotification,
    });
    return { harness: entry.harness, result, resident: !!key, residentKey: key };
  } catch (error) {
    if (key) await closeResidentEntry(key, entry);
    else await entry.harness.close().catch(() => {});
    throw error;
  } finally {
    entry.running = Math.max(0, entry.running - 1);
    if (key && residentHarnesses.get(key) === entry) scheduleResidentClose(key, entry);
  }
}

export async function probeHarnessRuntime() {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-harness-probe-"));
  const bin = fileURLToPath(import.meta.resolve("@deepseek-ai/dsh-sdk-jsonrpc-demo/bin"));
  const probeConfig = launchConfig({
    HARNESS_LLM_API_KEY: "probe-only-not-sent",
    HARNESS_LLM_BASE_URL: "https://example.invalid/v1",
    HARNESS_LLM_MODEL: "xenho-probe",
    HARNESS_LLM_PROTOCOL: "openai-completions",
  }, runDir, "fact-check", bin);
  await fs.writeFile(path.join(runDir, "context.json"), JSON.stringify({ localSources: [] }), "utf8");
  const harness = new DeepSeekHarness({
    launch: { command: process.execPath, args: probeConfig.args, cwd: process.cwd(), env: probeConfig.env, requestTimeoutMs: 60_000 },
    cwd: process.cwd(), provider: "xenho", model: "xenho-probe", maxTokens: 1024,
  });
  try {
    await harness.start();
    return { ok: true, version: HARNESS_VERSION };
  } finally {
    await harness.close().catch(() => {});
    await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
  }
}
