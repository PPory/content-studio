import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText } from "../src/lib/reader.js";

test("网页快照保留正文段落而不是压成一整块", () => {
  const text = htmlToText(`
    <html><body><nav>导航噪音</nav><main>
      <h1>文章标题</h1>
      <p>第一段正文。</p>
      <p>第二段正文，包含 <strong>重点</strong>。</p>
    </main><footer>页脚噪音</footer></body></html>
  `);
  assert.equal(text, "文章标题\n\n第一段正文。\n\n第二段正文，包含 重点 。");
  assert.doesNotMatch(text, /导航噪音|页脚噪音/);
});
