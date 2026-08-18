import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWritingAssistRequest, writingContext } from "../src/lib/writing-assist.js";

test("写作推动只接受三个确定模式", () => {
  assert.equal(normalizeWritingAssistRequest({ mode: "paragraph", content: "已有正文" }).mode, "paragraph");
  assert.equal(normalizeWritingAssistRequest({ mode: "finish", content: "已有正文" }).mode, "finish");
  assert.equal(normalizeWritingAssistRequest({ mode: "随便拼的", content: "已有正文" }).mode, "nudge");
});

test("空输入被拒绝，标题可以单独成为上下文", () => {
  assert.throws(() => normalizeWritingAssistRequest({}), /先写一个主题/);
  assert.equal(normalizeWritingAssistRequest({ title: "独立思考" }).title, "独立思考");
});

test("长正文同时保留开头与结尾", () => {
  const source = `开头${"中".repeat(300)}结尾`;
  const result = writingContext(source, 120);
  assert.ok(result.startsWith("开头"));
  assert.ok(result.endsWith("结尾"));
  assert.match(result, /中间内容已省略/);
  assert.ok(result.length <= 130);
});
