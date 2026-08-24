import assert from "node:assert/strict";
import { HARNESS_VERSION, harnessRuntimeInfo, probeHarnessRuntime } from "../server/agent-runtime/harness-adapter.mjs";
import { XENHO_QUALITY_NINE } from "../server/lib/quality-nine.mjs";

const info = await harnessRuntimeInfo({});
assert.equal(info.available, true, info.reason);
assert.equal(info.version, HARNESS_VERSION);
assert.equal(new Set(Object.values(info.versions)).size, 1, "Harness 直接依赖没有锁在同一版本");
assert.equal(info.configured, false, "空配置不该被误判为可执行");
assert.equal(XENHO_QUALITY_NINE.length, 9, "Xenho 品控问题必须保持九项唯一真源");
assert.deepEqual(new Set(XENHO_QUALITY_NINE.map((item) => item.id)).size, 9, "品控九问 id 重复");

const probe = await probeHarnessRuntime();
assert.deepEqual(probe, { ok: true, version: HARNESS_VERSION });
console.log(`✓ Harness ${HARNESS_VERSION} 已完成版本校验、启动握手和关闭`);
console.log("✓ Xenho 品控九问保持九项唯一真源");
