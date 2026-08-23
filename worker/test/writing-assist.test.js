import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWritingAssistRequest, writingContext, writingCursorContext } from "../src/lib/writing-assist.js";

test("写作推动只接受三个确定模式", () => {
  assert.equal(normalizeWritingAssistRequest({ mode: "paragraph", content: "已有正文" }).mode, "paragraph");
  assert.equal(normalizeWritingAssistRequest({ mode: "finish", content: "已有正文" }).mode, "finish");
  assert.equal(normalizeWritingAssistRequest({ mode: "随便拼的", content: "已有正文" }).mode, "nudge");
});

test("空输入被拒绝，标题可以单独成为上下文", () => {
  assert.throws(() => normalizeWritingAssistRequest({}), /先写一个主题/);
  assert.equal(normalizeWritingAssistRequest({ title: "独立思考" }).title, "独立思考");
});

test("默认风格和临时专家被保留为本轮上下文并限制长度", () => {
  const input = normalizeWritingAssistRequest({
    title: "独立思考",
    style: `克制直接${"风".repeat(8_000)}`,
    expert: `事实核查${"专".repeat(8_000)}`,
  });
  assert.ok(input.style.startsWith("克制直接"));
  assert.ok(input.expert.startsWith("事实核查"));
  assert.equal(input.style.length, 6_000);
  assert.equal(input.expert.length, 6_000);
});

test("长正文同时保留开头与结尾", () => {
  const source = `开头${"中".repeat(300)}结尾`;
  const result = writingContext(source, 120);
  assert.ok(result.startsWith("开头"));
  assert.ok(result.endsWith("结尾"));
  assert.match(result, /中间内容已省略/);
  assert.ok(result.length <= 130);
});

test("光标上下文以指定位置为中心，缺省时才使用文末", () => {
  const source = "前半段|后半段";
  const middle = writingCursorContext(source, 4);
  assert.equal(middle.cursor, 4);
  assert.equal(middle.before, "前半段|");
  assert.equal(middle.after, "后半段");
  assert.equal(writingCursorContext(source).cursor, source.length);
});

test("越界光标会被收进正文范围", () => {
  assert.equal(normalizeWritingAssistRequest({ content: "正文", cursor: -5 }).cursor, 0);
  assert.equal(normalizeWritingAssistRequest({ content: "正文", cursor: 999 }).cursor, 2);
});

test("长正文保留文章主题和光标附近内容", () => {
  const source = `主题开头${"甲".repeat(8_000)}光标左侧${"乙".repeat(8_000)}光标右侧${"丙".repeat(8_000)}文末`;
  const cursor = source.indexOf("光标右侧");
  const result = writingCursorContext(source, cursor, 1_000);
  assert.ok(result.overview.startsWith("主题开头"));
  assert.match(result.before, /乙+$/);
  assert.ok(result.after.startsWith("光标右侧"));
  assert.equal(result.cursor, cursor);
  assert.equal(result.truncated, true);
});
