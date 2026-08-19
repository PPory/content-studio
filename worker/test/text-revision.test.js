import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTextRevisionRequest } from "../src/lib/text-revision.js";

test("局部修订只接受五种模式", () => {
  for (const mode of ["polish", "correct", "shorten", "expand", "rewrite"]) {
    const body = { mode, selected: "这是一段需要修改的原文。", instruction: mode === "rewrite" ? "换成第一人称" : "" };
    assert.equal(normalizeTextRevisionRequest(body).mode, mode);
  }
  assert.equal(normalizeTextRevisionRequest({ mode: "随便拼的", selected: "原文" }).mode, "polish");
});

test("空选区与无指令改写会被拒绝", () => {
  assert.throws(() => normalizeTextRevisionRequest({ mode: "polish" }), /先选中/);
  assert.throws(() => normalizeTextRevisionRequest({ mode: "rewrite", selected: "原文" }), /具体的改写要求/);
});

test("上下文和指令有确定长度边界", () => {
  const result = normalizeTextRevisionRequest({
    mode: "expand",
    selected: "原文",
    before: "前".repeat(8_000),
    after: "后".repeat(8_000),
    instruction: "要求".repeat(400),
  });
  assert.equal(result.before.length, 4_000);
  assert.equal(result.after.length, 4_000);
  assert.equal(result.instruction.length, 500);
});

test("超长选区不会发给模型", () => {
  assert.throws(() => normalizeTextRevisionRequest({ mode: "polish", selected: "字".repeat(6_001) }), /最多处理/);
});
