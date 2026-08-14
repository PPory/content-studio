/**
 * Markdown → 安全 HTML 的**唯一**入口。
 *
 * 工作台里凡是走 `dangerouslySetInnerHTML` 的地方（正文 `Reader`、右栏 AI 输出 `Md`、
 * 热点原文）一律经过这里。**不允许任何页面自己 `marked.parse` 之后直接塞进 DOM**——
 * 那些内容全都来自外部：抓回来的网页、epub 转出来的 XHTML、Notion 里 LLM 写的稿、
 * 模型流式吐回来的字。它们里面出现 `<img onerror=…>`、`<iframe>`、`javascript:` 链接
 * 不是假设，是迟早的事，而工作台这一页里有 vault 的读写口、有 Worker 的写入口、
 * 有本机 CLI 通道——**在这一页里执行任意脚本 = 拿到这些能力**。
 *
 * 判据只写一处，理由和 `App.jsx` 那个外链委托监听一样：渲染路径以后还会再多，
 * 各写各的迟早漏一处，而漏掉的那处不报错、看不出来。
 *
 * 为什么引 DOMPurify 而不是自己写：这个项目的惯例是「十几行数学就别引包」，
 * 但 HTML 消毒**恰恰是反过来的那一类**——它的难点全在 mXSS、命名空间混淆、
 * innerHTML 二次解析这些没法靠读一遍代码想明白的地方。自己写的版本会「看起来对」，
 * 而它错的时候没有任何现象。这里的取舍标准不是行数，是「错了能不能被发现」。
 */

import { marked } from "marked";
import DOMPurify from "dompurify";
import { api } from "./api.js";

marked.setOptions({ breaks: true, gfm: true });

/**
 * 允许的标签：正常排版要用的全留着（标题、列表、引用、表格、图片、链接、代码块、
 * 折叠块、脚注用的 sup/sub），能主动执行或嵌进另一个页面的一个不留。
 *
 * 明确排除的是：script / style / iframe / frame / object / embed / form / input /
 * button / textarea / select / link / meta / base / svg / math。
 * 后两个（svg、math）看着无害，实际是 mXSS 最常用的入口（外来内容里也几乎不会有）。
 */
const ALLOWED_TAGS = [
  "p", "br", "hr", "span", "div",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "small", "sub", "sup",
  "blockquote", "q", "cite", "abbr",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "pre", "code", "kbd", "samp", "var",
  "a", "img", "figure", "figcaption",
  "details", "summary",
];

// 属性同理：排版要用的留着（表格对齐、图片尺寸、代码块语言 class），
// 事件属性一个都不给——DOMPurify 默认就砍 `on*`，这里再显式声明一次是为了让
// 「不允许自动触发行为」这条在代码里读得出来，而不是靠记住某个库的默认值。
const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "id", "lang", "dir",
  "colspan", "rowspan", "align", "width", "height",
  "start", "reversed", "type", "value", "open", "datetime",
  "target", "rel", "loading", "referrerpolicy",
  "data-hl", // 高亮标记自己写的，`Reader` 靠它认出 <mark> 再撤掉
];

/**
 * 链接协议白名单。`javascript:`、`vbscript:`、`data:text/html` 全部落在外面。
 * `data:image/*` 放行——epub 里的内嵌小图就是这么写的，而图片 data URI 执行不了脚本。
 */
/**
 * 最后那个**零宽负向前瞻**放行「裸相对路径」（`images/00001.jpg`、`cover.png`）——
 * 它匹配的是「开头不是 `协议:`」这件事本身，不吃掉任何字符。
 *
 * ⚠️ 少了它，epub 的插图**全都显示不出来**：epub 正文里的图就是写成 `images/x.jpg` 的，
 * 不带 `./`。DOMPurify 会把不在白名单里的 `src` **整个删掉**（不是删掉 img），
 * 于是页面上留下一个只有 alt 的破图框——看着像图丢了，其实是 src 被消毒掉了。
 * 而下游 `renderMarkdown` 那个改写正则 `(?!https?:|data:|\/)` 偏偏正是为裸相对路径写的，
 * 两处对不上。踩过一次，《平凡的世界》16 张插图全废。
 *
 * 安全性没有放松：`javascript:` / `vbscript:` / `data:text/html` 都以 `协议:` 开头，
 * 被前瞻挡在外面（`[a-z0-9+.-]*` 跨不过 `/`，所以 `a/b:c.jpg` 这种也算相对路径，正确）。
 */
export const SAFE_URI = /^(?:https?:|mailto:|tel:|ftp:|#|\/|\.{1,2}\/|data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);base64,|(?![a-z0-9+.-]*:))/i;

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "A") return;
    const href = node.getAttribute("href") || "";
    // 外链补上安全打开方式。`App.jsx` 的委托监听在点击那一刻也会补一遍——
    // 两处不冲突：这里管的是「HTML 本身就是对的」，那里管的是「界面上手写的 <a> 也一样」。
    // rel 一定要有 noopener：不带的话新窗口的 `window.opener` 指得回工作台，
    // 那个页面能把工作台这一栏导航到别处去。
    if (/^https?:/i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/**
 * 消毒一段 HTML。给外部直接调用是为了那些**不经过 Markdown**的入口
 * （以后如果有直接拿到 HTML 的源）。
 */
export function sanitizeHtml(html) {
  installHooks();
  return DOMPurify.sanitize(String(html || ""), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI,
    FORBID_TAGS: ["script", "style", "iframe", "frame", "frameset", "object", "embed", "form", "input", "button", "textarea", "select", "option", "link", "meta", "base"],
    FORBID_ATTR: ["style", "srcdoc", "formaction", "xlink:href", "ping"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    // svg / mathml 整个关掉：这两个命名空间是 mXSS 的主战场，而外来正文里不会有它们
    USE_PROFILES: { html: true },
    KEEP_CONTENT: true,
  });
}

/**
 * Obsidian 的 `[[路径/名字]]` 在 marked 眼里就是普通文本，于是正文里铺出一串方括号
 * 加完整 vault 路径——又长又不可点，还会把一行撑成两行。这里按 Obsidian 的规则
 * 显示它该显示的那截：有 `|` 取别名，否则取最后一段路径。
 *
 * **只脱壳不做成链接**：工作台没有「按名字解析 vault 链接」这套东西，
 * 画一个点了没反应的链接比给纯文本更糟。代码围栏里的原样留着——
 * 那儿的方括号多半正是要展示的内容。
 */
export function unwrapWikilinks(text) {
  return String(text || "")
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg, i) =>
      i % 2
        ? seg
        : seg.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, target, alias) =>
            alias ? alias.trim() : target.split("/").pop().trim()
          )
    )
    .join("");
}

/**
 * 把标点从强调标记**里面**挪到外面，渲染前做一次。
 *
 * CommonMark 判断 `**` 能不能开合看两侧字符（flanking rules）：闭合的 `**` 不能
 * 「前面是标点、后面是字母」。中文正文里到处踩这条——
 *
 *     **第一种是劳动力杠杆，**也就是让别人给你打工。
 *
 * 闭合的 `**` 前面是全角逗号、后面是汉字，于是**整段不加粗，两个星号原样显示在正文里**。
 * 挪成 `**第一种是劳动力杠杆**，也就是……` 两边就都合法了，而且排版上本来就更对：
 * 标点属于句子，不属于被强调的那个词。
 *
 * 这里做是为了兜住**所有源**：Notion 里 LLM 写的中文稿同样会踩，那些内容不归导入器管。
 * `server/lib/books.mjs` 的 `fixEmphasis` 是同一份规则，改一处要改两处——
 * 那边是让落进 vault 的文件本身就正确（Obsidian 也要读）。
 */
export function fixEmphasis(text) {
  return String(text || "").replace(/(\*{1,2})([^*\n]+?)\1/g, (whole, mark, inner) => {
    const lead = inner.match(/^[\s\p{P}]+/u)?.[0] || "";
    // 尾部在**去掉头之后的那截**里找：直接在整段上各找一次的话，`**——**` 这种
    // 全是标点的会让头尾匹配到同一段字符，拼回去凭空多一份
    const rest = inner.slice(lead.length);
    if (!rest) return lead;
    const trail = rest.match(/[\s\p{P}]+$/u)?.[0] || "";
    const core = rest.slice(0, rest.length - trail.length);
    return core ? `${lead}${mark}${core}${mark}${trail}` : `${lead}${trail}`;
  });
}

/**
 * Markdown → 可以直接塞进 DOM 的 HTML。
 *
 * `baseDir` 给了的话，正文里的相对图片路径（`![](images/00001.jpeg)`，epub 导进来
 * 就是这么写的）会改写成 vault 的图片接口。**改写在消毒之后做**：消毒会把
 * `javascript:` 这类 src 干掉，改写只认「不是 http/data/绝对路径」的那些，
 * 顺序反过来的话等于在已经消毒过的串上再拼一次字符串。
 */
export function renderMarkdown(text, { baseDir = "" } = {}) {
  const raw = marked.parse(fixEmphasis(unwrapWikilinks(text || "")));
  let html = sanitizeHtml(raw);
  if (baseDir) {
    html = html.replace(
      /<img([^>]*?)src="(?!https?:|data:|\/)([^"]+)"/g,
      (_, pre, src) => `<img${pre}src="${api.imageUrl(`${baseDir}/${src}`)}"`
    );
  }
  return markGlyphImages(html);
}

/**
 * 段落里**和文字混排**的图 = 「用图代替字」，按行高显示。
 *
 * epub 里这是常见做法：字体没有的生僻字（《平凡的世界》的「圪塄」）、公式、特殊符号，
 * 出版社直接切成小图嵌进句子。这类图实测 175×200、5KB，而同一本书里真正的插图是
 * 1766×2539。按原尺寸铺出来，一个字会变成 200px 高的一块，**把句子劈成上下两半**——
 * 图是显示出来了，但那一段没法读了。
 *
 * 判据是「这一段里除了图还有没有字」，不是图的尺寸——尺寸要等图加载完才知道，
 * 而且真有小插图。**CSS 表达不了这个判据**：`:only-child` 只数元素子节点，
 * 一段「文字 + img + 文字」里那个 img 照样是 `:only-child`。所以在 HTML 串上做。
 */
export function markGlyphImages(html) {
  return String(html || "").replace(/<p>([\s\S]*?)<\/p>/g, (block, inner) => {
    if (!inner.includes("<img")) return block;
    const words = inner.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
    return words ? block.replace(/<img\b/g, '<img class="glyph"') : block;
  });
}
