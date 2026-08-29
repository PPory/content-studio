import assert from "node:assert/strict";
import test from "node:test";
import { isLegacyReadOnly, legacyReadOnlyAllows } from "../src/lib/legacy-read-only.js";

test("迁移只读开关只接受明确启用值", () => {
  assert.equal(isLegacyReadOnly({ MIGRATION_READ_ONLY: "1" }), true);
  assert.equal(isLegacyReadOnly({ MIGRATION_READ_ONLY: "TRUE" }), true);
  assert.equal(isLegacyReadOnly({ MIGRATION_READ_ONLY: "0" }), false);
  assert.equal(isLegacyReadOnly({}), false);
});

test("迁移只读期只允许健康检查和 wb 读请求", () => {
  assert.equal(legacyReadOnlyAllows(new Request("https://example.com/")), true);
  assert.equal(legacyReadOnlyAllows(new Request("https://example.com/wb/projects")), true);
  assert.equal(legacyReadOnlyAllows(new Request("https://example.com/wb/projects", { method: "POST" })), false);
  assert.equal(legacyReadOnlyAllows(new Request("https://example.com/run/draft")), false);
  assert.equal(legacyReadOnlyAllows(new Request("https://example.com/lark", { method: "POST" })), false);
});