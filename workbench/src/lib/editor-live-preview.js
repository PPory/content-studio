/**
 * 实时预览：**Markdown 记号始终隐去，正文始终保持排版后的样子。**
 *
 * 这是“所见即源码”编辑器一直缺的那一块——
 * 上一版靠一颗「预览」按钮在「能改但难看」和「好看但不能改」之间切，
 * 而**一个「看排版后的样子」的开关，等于承认平时看的不是那个样子**。
 *
 * ⚠️ **文档本身一个字节都没变。** 隐藏是 `Decoration.replace`（把 `#`、`**` 那几个字符
 * 换成零宽），渲染是 widget。存回去的仍然是原字节的 Markdown——`[[双链]]`、脚注、
 * `> [!note]` 这类扩展语法不会被任何一次「保存」重写。这条是这个编辑器
 * 选 CodeMirror 而不是富文本内核的全部理由，实时预览不能把它换掉。
 *
 * 光标和选区只编辑内容，不再让当前行突然切回源码。格式变化由菜单和快捷键完成。
 */
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { decodeMarkdownPath } from "./markdown-path.js";

/** 图片。`src` 由外面给的 `resolveUrl` 解析——相对路径怎么变成可取的地址不是这一层的事。 */
class ImageWidget extends WidgetType {
  constructor({ url, alt, raw }) {
    super();
    this.url = url;
    this.alt = alt;
    this.raw = raw;
  }
  eq(other) {
    return other.url === this.url && other.alt === this.alt;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-media";
    const kind = mediaKind(this.url);
    if (kind === "video") {
      const video = document.createElement("video");
      video.src = this.url;
      video.controls = true;
      video.preload = "metadata";
      wrap.append(video);
    } else {
      const img = document.createElement("img");
      img.src = this.url;
      img.alt = this.alt || "";
      img.loading = "lazy";
      // 取不到就退回显示原始那行 Markdown——**不要显示一个碎图图标**，
      // 那个图标既不说明发生了什么，也没给下一步
      img.addEventListener("error", () => {
        wrap.textContent = this.raw;
        wrap.dataset.broken = "true";
      });
      wrap.append(img);
    }
    if (this.alt) {
      const caption = document.createElement("small");
      caption.textContent = this.alt;
      wrap.append(caption);
    }
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i;

export function mediaKind(url) {
  return VIDEO_EXT.test(String(url || "")) ? "video" : "image";
}

/**
 * 整行就是一张图（`![alt](src)` 独占一行）时，才换成 widget。
 *
 * ⚠️ **目标里可以有空格。** 上一版写的是 `[^)\s]+`，于是
 * `![](导入目录/附件/x.jpg)` 这种带空格的相对路径**一条都匹配不上**，
 * 现象是正文里只显示那行链接文字。整行必须以 `)` 收尾，所以贪婪匹配到最后一个 `)` 是安全的。
 * `<...>` 是 CommonMark 给「目标里有空格」的正式写法，一并认。
 */
const IMAGE_LINE = /^!\[([^\]]*)\]\(\s*(.+?)\s*\)\s*$/;
const INCOMPLETE_ASSET_IMAGE_LINE = /^!\[([^\]]*)\]\(\s*(asset:\/\/[^\s)]+)\s*$/;
const imageLineOf = (text) => text.match(IMAGE_LINE) || text.match(INCOMPLETE_ASSET_IMAGE_LINE);

/**
 * 行内记号：`**粗**`、`*斜*`、`~~删~~`、`` `码` ``。
 *
 * 用正则而不是语法树：`@codemirror/lang-markdown` 的树里这些标记是
 * `EmphasisMark` / `CodeMark` 节点，遍历更准，但也更容易在嵌套和中文标点边界上
 * 出现「隐了一半」的怪样子。这里只隐**成对且同一行内**的记号，
 * 判不准的一律不隐——**宁可露出记号，也不能让文字缺一块**。
 */
const INLINE_MARKS = [
  { re: /(\*\*)(?=\S)([\s\S]*?\S)(\*\*)/g, cls: "cm-lp-strong" },
  { re: /(~~)(?=\S)([\s\S]*?\S)(~~)/g, cls: "cm-lp-strike" },
  { re: /(`)(?=[^`])([^`\n]*?)(`)/g, cls: "cm-lp-code" },
];

function buildDecorations(view, resolveUrl) {
  const builder = [];
  const atomic = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      const text = line.text;
      if (!text) continue;

      /**
       * 图片行始终保持预览。
       *
       * 对缺少最后一个右括号的历史 asset 引用只做容错显示，不改写正文；完整或容错图片行
       * 都作为一个原子范围，光标和退格不会钻进 URI 里只删掉半截。
       */
      const image = imageLineOf(text);
      if (image) {
        const url = resolveUrl(decodeMarkdownPath(image[2]));
        const range = Decoration.replace({
          widget: new ImageWidget({ url, alt: image[1], raw: text }),
          block: false,
        }).range(line.from, line.to);
        builder.push(range);
        atomic.push(range);
        continue;
      }

      /**
       * 分隔线。`/` 菜单里的「分隔线」插的就是 `---`——**我们自己产出的记号，
       * 自己的实时预览却渲染不了**，插完屏幕上留着三个横杠。
       */
      if (/^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
        builder.push(Decoration.replace({ widget: new RuleWidget() }).range(line.from, line.to));
        continue;
      }

      // 标题：始终隐掉 `#` 和它后面那个空格，选中标题时也只看到标题本身
      const heading = text.match(/^(#{1,6})\s/);
      if (heading) builder.push(Decoration.replace({}).range(line.from, line.from + heading[0].length));

      // 引用：隐掉 `>`，左边那道竖线由 CSS 画
      const quote = text.match(/^(>\s?)+/);
      if (quote) {
        builder.push(Decoration.replace({}).range(line.from, line.from + quote[0].length));
        builder.push(Decoration.line({ class: "cm-lp-quote" }).range(line.from));
      }

      // 无序列表：`- ` → `• `，序号列表的数字本来就是内容，不动
      const bullet = text.match(/^(\s*)([-*+])\s/);
      if (bullet && !/^\s*[-*+]\s\[[ xX]\]/.test(text)) {
        builder.push(Decoration.replace({ widget: new BulletWidget() }).range(line.from + bullet[1].length, line.from + bullet[0].length));
      }

      for (const { re, cls } of INLINE_MARKS) {
        re.lastIndex = 0;
        let match = re.exec(text);
        while (match) {
          const start = line.from + match.index;
          const openEnd = start + match[1].length;
          const closeStart = start + match[0].length - match[3].length;
          builder.push(Decoration.replace({}).range(start, openEnd));
          builder.push(Decoration.mark({ class: cls }).range(openEnd, closeStart));
          builder.push(Decoration.replace({}).range(closeStart, start + match[0].length));
          match = re.exec(text);
        }
      }
    }
  }
  // ⚠️ **必须自己排序。** `RangeSetBuilder` 要求按 from 递增喂进去，而上面是按
  // 「先块级后行内」的顺序生成的，行内那批的 from 会小于同一行块级记号之后的位置。
  builder.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const set = new RangeSetBuilder();
  for (const range of builder) set.add(range.from, range.to, range.value);
  const atomicSet = new RangeSetBuilder();
  for (const range of atomic) atomicSet.add(range.from, range.to, range.value);
  return { decorations: set.finish(), atomic: atomicSet.finish() };
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-lp-rule";
    return rule;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-lp-bullet";
    dot.textContent = "•";
    return dot;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * `resolveUrl(src)` 把正文里的相对路径变成能取的地址。
 * 编辑器不知道导入源或资产库在哪、也不该知道——这一层只管画。
 */
export function livePreview({ resolveUrl = (src) => src } = {}) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      const built = buildDecorations(view, resolveUrl);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        const built = buildDecorations(update.view, resolveUrl);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
      }
    }
  }, {
    decorations: (value) => value.decorations,
  });
  return [
    plugin,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic || Decoration.none),
  ];
}
