import assert from "node:assert/strict";
import { HARNESS_RESIDENT_IDLE_MS, HARNESS_VERSION, harnessChildEnv, harnessRuntimeInfo, probeHarnessRuntime } from "../server/agent-runtime/harness-adapter.mjs";
import { assistantSkills } from "../server/agent-runtime/assistant-runner.mjs";
import { guidedSessionId } from "../server/agent-runtime/guided-runner.mjs";
import { XENHO_QUALITY_NINE } from "../server/lib/quality-nine.mjs";

const info = await harnessRuntimeInfo({});
assert.equal(info.available, true, info.reason);
assert.equal(info.version, HARNESS_VERSION);
assert.equal(new Set(Object.values(info.versions)).size, 1, "Harness 直接依赖没有锁在同一版本");
assert.equal(info.configured, false, "空配置不该被误判为可执行");
assert.equal(XENHO_QUALITY_NINE.length, 9, "Xenho 品控问题必须保持九项唯一真源");
assert.equal(HARNESS_RESIDENT_IDLE_MS, 15 * 60 * 1_000, "常驻 Harness 的闲置回收时间被意外改动");
assert.deepEqual(new Set(XENHO_QUALITY_NINE.map((item) => item.id)).size, 9, "品控九问 id 重复");
const skills = await assistantSkills();
assert.deepEqual(skills.items.map((item) => item.id).sort(), ["idea-dialogue", "interview-to-draft"], "项目 Harness Skill 没有从真实目录读取");
const restored = "50879135-9d18-49a3-bab4-d8aab36be661";
assert.equal(guidedSessionId(restored), restored, "已有 Harness 会话号不该被替换");
assert.match(guidedSessionId(""), /^[0-9a-f-]{36}$/i, "新对话没有生成合法会话号");

const child = harnessChildEnv({ HTTPS_PROXY: "http://127.0.0.1:10808", NO_PROXY: "localhost" }, ".xenho/test", "fact-check");
assert.equal(child.HTTPS_PROXY, "http://127.0.0.1:10808", "Harness 子进程丢失工作台代理");
assert.equal(child.NO_PROXY, "localhost", "Harness 子进程丢失代理例外规则");

const probe = await probeHarnessRuntime();
assert.deepEqual(probe, { ok: true, version: HARNESS_VERSION });
console.log(`✓ Harness ${HARNESS_VERSION} 已完成版本校验、启动握手和关闭`);
console.log("✓ 常驻会话隔离、项目 Skill 注册和续聊会话号已校验");
console.log("✓ Xenho 品控九问保持九项唯一真源");
