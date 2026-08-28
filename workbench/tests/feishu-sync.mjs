import assert from "node:assert/strict";
import {
  decideDocumentSync,
  documentFingerprint,
  hasProtectedFeishuBlocks,
  parseLarkCliJson,
  resolveLarkCliInvocation,
} from "../server/lib/feishu-sync.mjs";

const local = documentFingerprint("标题", "正文\r\n第二行");
assert.equal(local, documentFingerprint("标题", "正文\n第二行"), "换行差异不应制造冲突");

const binding = { contentHash: "old-local", remoteHash: "old-remote" };
assert.equal(decideDocumentSync(null, local, "remote").action, "create");
assert.equal(decideDocumentSync(binding, "new-local", "old-remote").action, "push");
assert.equal(decideDocumentSync(binding, "old-local", "new-remote").action, "pull-preview");
assert.equal(decideDocumentSync(binding, "new-local", "new-remote").action, "conflict");
assert.equal(decideDocumentSync(binding, "old-local", "old-remote").action, "none");

const parsed = parseLarkCliJson('提示文字\n{"ok":true,"data":{"doc_id":"doxcn12345678"}}');
assert.equal(parsed.doc_id, "doxcn12345678");
assert.throws(() => parseLarkCliJson('{"ok":false,"error":{"message":"denied"}}'), /denied/);
assert.equal(hasProtectedFeishuBlocks("普通正文\n## 小节"), false);
assert.equal(hasProtectedFeishuBlocks("<image token=\"img_123\"/>"), true);
assert.equal(hasProtectedFeishuBlocks("<bitable token=\"tbl_123\"/>"), true);

const cliScript = "C:\\Users\\Lenovo\\bin\\node_modules\\@larksuite\\cli\\scripts\\run.js";
const invocation = resolveLarkCliInvocation(["docs", "+fetch"], {
  platform: "win32",
  pathValue: "C:\\Tools;C:\\Users\\Lenovo\\bin",
  nodePath: "C:\\Program Files\\node.exe",
  existsSync: (candidate) => candidate === cliScript,
});
assert.equal(invocation.command, "C:\\Program Files\\node.exe");
assert.deepEqual(invocation.args, [cliScript, "docs", "+fetch"]);
assert.deepEqual(
  resolveLarkCliInvocation(["docs"], { platform: "linux" }),
  { command: "lark-cli", args: ["docs"] }
);

console.log("飞书同步纯逻辑通过");
