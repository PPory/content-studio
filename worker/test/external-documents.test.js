import test from "node:test";
import assert from "node:assert/strict";
import { mapExternalDocument, normalizeExternalDocumentInput } from "../src/lib/external-documents.js";

const ENTITY_ID = "01K2YQ0PVG6TP8H9Q4VJ3M7N5R";

test("飞书映射只接受稿件和飞书地址", () => {
  const value = normalizeExternalDocumentInput("draft", ENTITY_ID, {
    provider: "feishu",
    externalId: "doxcnAbCdEfGhIjKlMn",
    externalUrl: "https://example.feishu.cn/wiki/wikcnAbCdEfGhIjKlMn",
    contentHash: "local-hash",
    remoteHash: "remote-hash",
  });
  assert.equal(value.entityType, "draft");
  assert.equal(value.lastSource, "local");
  assert.throws(() => normalizeExternalDocumentInput("material", ENTITY_ID, value), /内容类型/);
  assert.throws(() => normalizeExternalDocumentInput("draft", ENTITY_ID, { ...value, externalUrl: "https://example.com/doc" }), /只接受飞书/);
  assert.throws(() => normalizeExternalDocumentInput("draft", "../bad", value), /内容 id/);
});

test("飞书映射响应不暴露数据库列名", () => {
  const mapped = mapExternalDocument({
    id: "mapping-1",
    provider: "feishu",
    entity_type: "draft",
    entity_id: ENTITY_ID,
    external_id: "doxcnAbCdEfGhIjKlMn",
    external_url: "https://example.feishu.cn/docx/doxcnAbCdEfGhIjKlMn",
    container_id: "my_library",
    content_hash: "local-hash",
    remote_hash: "remote-hash",
    last_source: "remote",
    last_synced_at: 1_700_000_000,
  });
  assert.equal(mapped.entityId, ENTITY_ID);
  assert.equal(mapped.lastSource, "remote");
  assert.ok(!("entity_id" in mapped));
  assert.match(mapped.lastSyncedAt, /^2023-/);
});
