import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCreationRequest, keepRealPicks } from "../src/lib/creation.js";
import { MODEL_TASKS } from "../src/lib/models.js";

test("空白稿要求标题和平台", () => {
  assert.throws(() => normalizeCreationRequest({ kind: "draft", title: "", platform: "公众号" }), /标题/);
  assert.throws(() => normalizeCreationRequest({ kind: "draft", title: "测试", platform: "" }), /平台/);
  assert.equal(normalizeCreationRequest({ kind: "draft", title: " 测试 ", platform: "公众号" }).title, "测试");
});

test("素材起稿去重并过滤非法 id", () => {
  const id = "01K2YQ0PVG6TP8H9Q4VJ3M7N5R";
  const value = normalizeCreationRequest({ kind: "draft", mode: "material", title: "测试", platform: "X", materialIds: [id, id, "../bad"] });
  assert.deepEqual(value.materialIds, [id]);
});

test("素材稿正文完全以编辑器内容为准", () => {
  const empty = normalizeCreationRequest({
    kind: "draft",
    mode: "material",
    title: "测试",
    platform: "公众号",
    materialIds: ["01K2YQ0PVG6TP8H9Q4VJ3M7N5R"],
    body: "",
  });
  const value = normalizeCreationRequest({
    kind: "draft",
    mode: "material",
    title: "测试",
    platform: "公众号",
    materialIds: ["01K2YQ0PVG6TP8H9Q4VJ3M7N5R"],
    body: "修改后的正文",
  });
  assert.equal(empty.body, "");
  assert.equal(value.body, "修改后的正文");
});

// ⚠️ 「按意思挑素材」这道闸：模型给回来的 id 必须在真实候选里。
// 放行一个不存在的 id，工作台上就是一张点了打不开的卡——「没找到」是诚实的答案，
// 一张打不开的卡是假的答案。**界面上完全看不出这道闸有没有生效**，只能靠这里钉。
test("按意思挑素材只放行真实存在的 id", () => {
  const pool = [{ id: "m1" }, { id: "m2" }];
  assert.deepEqual(keepRealPicks([{ id: "m1", why: " 讲的是长期积累 " }], pool), [{ id: "m1", why: "讲的是长期积累" }]);
  assert.deepEqual(keepRealPicks([{ id: "编的" }, { id: "m2", why: "" }], pool), [{ id: "m2", why: "" }]);
  assert.equal(keepRealPicks([{ id: "m1" }, { id: "m1" }], pool).length, 1, "同一条被挑两次只留一条");
  assert.deepEqual(keepRealPicks("模型没给数组", pool), []);
  assert.deepEqual(keepRealPicks(undefined, pool), []);
  assert.equal(keepRealPicks([{ id: "m1" }, { id: "m2" }], pool, 1).length, 1, "上限要生效");
});

/**
 * ⚠️ **每个 `task: "xxx"` 都必须在 `MODEL_TASKS` 里有一条。**
 *
 * 认不出的环节名不会报错——`modelFor` 退回 `env.LLM_MODEL`，一切照跑。这是有意的
 * （新加调用点时忘了标环节，不该让流水线停摆），代价是**打错一个字就是「设置里改了没反应」**，
 * 而那种问题几乎查不出来。所以在这里扫一遍源码兜住。
 */
test("所有调用点标的环节名都在清单里", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  // ⚠️ 走 `fileURLToPath`，不要自己从 URL 的 pathname 拼路径：这个仓库的绝对路径里有中文，
  // pathname 拿到的是 `%E6%A1%8C%E9%9D%A2` 那种百分号编码，`readdir` 直接 ENOENT。
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files = [];
  const walk = async (dir) => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full);
      else if (item.name.endsWith(".js")) files.push(full);
    }
  };
  await walk(root);
  const known = new Set(MODEL_TASKS.map((t) => t.key));
  const used = new Set();
  for (const file of files) {
    if (file.endsWith("models.js")) continue;   // 清单自己
    for (const m of (await readFile(file, "utf8")).matchAll(/\btask:\s*"([a-z-]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 6, `扫到的环节太少（${used.size}），选择器可能失效了`);
  for (const one of used) assert.ok(known.has(one), `${one} 不在 MODEL_TASKS 里`);
});

test("环节 key 不重复", () => {
  assert.equal(new Set(MODEL_TASKS.map((t) => t.key)).size, MODEL_TASKS.length);
  assert.ok(MODEL_TASKS.every((t) => t.key && t.label && t.hint), "每个环节都要有 label 和选型建议——面板整个从这份清单渲染");
});
