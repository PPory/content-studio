/**
 * 正文里的路径 ⇄ 能交给渲染器的路径。
 *
 * **写进正文时编码，读出来解析时解码。** 空格和括号在 Markdown 里有语法含义，
 * 留在正文里等于写了一段解析不出来的图片语法——不只是我们的实时预览看不见，
 * `marked`、别的编辑器、发布到平台后的渲染**全都看不见**。
 * 所以这条不是渲染层的宽容问题，是**写入时就该写成合法 Markdown**。
 *
 * 单独一个文件而不是挂在 `editor-live-preview.js` 上：`markdown.js` 也要用它，
 * 而那条路径不该为了两个纯字符串函数把整个 CodeMirror 拖进 bundle。
 */

export function encodeMarkdownPath(path) {
  return String(path || "")
    .replace(/%/g, "%25")
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
}

/** 反过来。解不开的（比如正文里本来就有一个孤零零的 `%`）原样返回，不抛。 */
export function decodeMarkdownPath(path) {
  const raw = String(path || "").replace(/^<|>$/g, "");
  try { return decodeURIComponent(raw); } catch { return raw; }
}
