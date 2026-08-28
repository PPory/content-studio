import assert from "node:assert/strict";
import {
  canRebuildFeishuImages,
  decideDocumentSync,
  documentFingerprint,
  feishuImageTokens,
  hasProtectedFeishuBlocks,
  isDifferentFeishuTarget,
  markdownImageReferences,
  parseLarkCliJson,
  replaceMarkdownImages,
  resolveLarkCliInvocation,
} from "../server/lib/feishu-sync.mjs";
import { mediaIdFromReference, mediaReference, sniffImageType } from "../server/lib/supabase-media.mjs";

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
assert.equal(hasProtectedFeishuBlocks("<image token=\"img_123\"/>", { allowImages: true }), false);
assert.equal(hasProtectedFeishuBlocks("<bitable token=\"tbl_123\"/>"), true);
assert.equal(hasProtectedFeishuBlocks("<bitable token=\"tbl_123\"/>", { allowImages: true }), true);
assert.equal(canRebuildFeishuImages({ lastSource: "local" }, "![图](.xenho-media/11111111-1111-4111-8111-111111111111)"), true);
assert.equal(canRebuildFeishuImages({ lastSource: "remote" }, "普通正文"), false);
assert.equal(canRebuildFeishuImages({ lastSource: "local" }, '<image token="img_remote"/>'), false);
assert.equal(isDifferentFeishuTarget({ containerId: "my_library" }, "https://example.feishu.cn/wiki/target"), true);
assert.equal(isDifferentFeishuTarget({ containerId: "wiki-target" }, "wiki-target"), false);

const imageMarkdown = "前文\n\n![示例图](99%20-%20个人工作台/07%20-%20附件/demo.png)\n\n后文";
assert.deepEqual(markdownImageReferences(imageMarkdown).map((item) => item.source), [
  "99%20-%20个人工作台/07%20-%20附件/demo.png",
]);
const replaced = await replaceMarkdownImages(imageMarkdown, async () => ({ url: "https://example.com/signed?a=1&b=2" }));
assert.match(replaced.markdown, /<image url="https:\/\/example\.com\/signed\?a=1&amp;b=2" alt="示例图"\/>/);
assert.deepEqual(feishuImageTokens('<image token="img_a"/>\n<image token="img_b" />'), ["img_a", "img_b"]);

const assetId = "11111111-1111-4111-8111-111111111111";
assert.equal(mediaReference(assetId), `.xenho-media/${assetId}`);
assert.equal(mediaIdFromReference(encodeURIComponent(mediaReference(assetId))), assetId);
assert.equal(sniffImageType(Buffer.from("89504e470d0a1a0a0000", "hex")), "image/png");
assert.equal(sniffImageType(Buffer.from("ffd8ffe000", "hex")), "image/jpeg");
assert.equal(sniffImageType(Buffer.from("not an image")), "");

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
