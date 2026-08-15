import test from "node:test";
import assert from "node:assert/strict";
import { buildMaterialStarter, normalizeCreationRequest } from "../src/lib/creation.js";

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

test("素材正文只使用服务端查到的内容", () => {
  const text = buildMaterialStarter("标题", [{ title: "案例", content: "第一行\n第二行" }]);
  assert.match(text, /^# 标题/);
  assert.match(text, /> 第一行\n> 第二行/);
  assert.match(text, /写完后可删掉/);
});

test("素材稿保存用户在编辑器中修改后的正文", () => {
  const value = normalizeCreationRequest({
    kind: "draft",
    mode: "material",
    title: "测试",
    platform: "公众号",
    materialIds: ["01K2YQ0PVG6TP8H9Q4VJ3M7N5R"],
    body: "修改后的正文",
  });
  assert.equal(value.body, "修改后的正文");
});
