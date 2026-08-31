// 冷启动语料导入：把一堆本地 md 和飞书导出的 zip 变成书架上的「资料」。
//
// ⚠️ **这里只做纯计算**：扫描结果进来，书和章节的计划出去。写库、写资产和落盘
// 都由调用方（`scripts/import-corpus.mjs`）做。这样切块和清洗规则能单测，
// 不必先造一个真实工作区。
//
// 为什么导成书而不是新建一层「原始资料」：`books` + `book_documents` 的形状
// 已经完全对上了（一本书 N 个文档），`book_document` 本身就是实体、已经进 FTS、
// 已经有阅读界面和划词入库。词条的事实要挂 `source_entity_id`，直接挂章节就行。
// 再造一层原始资料等于把同一条规则实现两遍。`metadata_json.kind` 里的
// 「资料 / 藏书」之分也是现成的。

import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

/** 一个章节的字数上限。它同时是**一次 ingest 的单位**，所以不是排版问题而是成本问题。 */
export const MAX_DOCUMENT_CHARS = 12_000;
/** 切出来太碎的块并回上一块——「第 7 节」只有两行的话，它自己成不了一个知识单位。 */
const MIN_DOCUMENT_CHARS = 800;

const FEISHU_ASSET_DIR = "图片和附件";
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

/**
 * 飞书导出的正文噪音。
 *
 * 实测一篇 19KB 的导出里：反斜杠转义 177 处（`& [ ] . < > _ * - ! ( )` 全都被转义了）、
 * 三个以上连续星号 56 处、`&nbsp;` 3 处。这些**必须在入库前清掉**——它们会原样
 * 进入词条的「关键事实」，而事实是要给人读的。
 */
export function cleanFeishuMarkdown(input) {
  let text = String(input || "");
  // 反斜杠 + ASCII 标点 → 标点本身。`\\` 留着（那是真的反斜杠）。
  text = text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, "$1");
  text = text.replace(/&nbsp;/g, " ");
  // `*** 任务 ***`、`** ***** 迭代 ***** **` 这类坏粗体：先把星号串压成两个，
  // 再把粗体标记内侧的空格收掉，最后清掉压出来的空粗体。
  text = text.replace(/\*{3,}/g, "**");
  for (let pass = 0; pass < 3; pass += 1) text = text.replace(/\*\*[ \t]+([^*\n]+?)[ \t]+\*\*/g, "**$1**");
  text = text.replace(/\*\*[ \t]*\*\*/g, "");
  // 飞书每个块之间空两行，段落一多就撑得正文全是空白。
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.replace(/[ \t]+$/gm, "").trim();
}

/**
 * 飞书裸导出（没打包成 zip 的）里的图片是**带鉴权和过期时间戳的临时链接**，
 * 形如 `internal-api-drive-stream.feishu.cn/...?code=...`。它们已经或即将失效，
 * 而且需要登录态。
 *
 * ⚠️ **不静默保留。** 留着的结果是正文里永远加载不出来的破图，而且用户不知道
 * 为什么。识别出来交给调用方，由它决定是标注还是丢弃。
 */
export function findDeadFeishuImages(input) {
  const dead = [];
  for (const match of String(input || "").matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = match[1];
    if (/internal-api-drive-stream\.feishu\.cn/.test(url) || /[?&](code|authcode)=/.test(url)) dead.push({ markdown: match[0], url });
  }
  return dead;
}

/** 把死链换成一句人话，别留破图。 */
export function stripDeadFeishuImages(input) {
  let text = String(input || "");
  for (const item of findDeadFeishuImages(text)) text = text.split(item.markdown).join("〔原文此处有图片，飞书导出链接已失效〕");
  return text;
}

/**
 * 标题里的行内 markdown 要去掉。飞书导出的 H2 常常写成 `## **角色 (Persona)**`，
 * 原样拿去当章节名，书架目录里就会出现一排星号——**标题是导航，不是正文**。
 */
export function cleanHeadingTitle(input) {
  return String(input || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function headingLevel(line) {
  const match = /^(#{1,6})\s+(\S.*)$/.exec(line);
  return match ? { level: match[1].length, title: cleanHeadingTitle(match[2]) } : null;
}

/**
 * 把一份长文切成若干章节。
 *
 * 现成的 `books.mjs#parseText` 只认 H1 而且要求至少 3 个——这批语料里对不上：
 * 智识思维课的「文字稿」有 1 个 H1 + 十几个 H2，而「延伸阅读」和「答疑」
 * **一个标题都没有**。所以这里按「先找最细的可用标题层级，找不到就按段落攒」来切。
 */
export function splitDocument(title, input, { maxChars = MAX_DOCUMENT_CHARS } = {}) {
  const text = String(input || "").trim();
  if (!text) return [];
  if (text.length <= maxChars) return [{ title, text }];

  const lines = text.split("\n");
  // 选切分层级：从 H1 往下找第一个**出现两次以上**的层级。只出现一次的标题
  // （多数文件开头那个书名 H1）切出来是「一整篇 + 一个空壳」，没有意义。
  for (let level = 1; level <= 3; level += 1) {
    const marks = lines.map((line, index) => ({ index, heading: headingLevel(line) }))
      .filter((item) => item.heading?.level === level);
    if (marks.length < 2) continue;
    const sections = [];
    const lead = lines.slice(0, marks[0].index).join("\n").trim();
    // ⚠️ 短导语**并进第一节，但用第一节的标题**。
    // 反过来（让导语当一节、再把第一节并进它）会把「第一节」这个名字吃掉，
    // 目录里就只剩一个书名——而小节名正是切块之后唯一的导航。
    if (lead && lead.length >= MIN_DOCUMENT_CHARS) sections.push({ title, text: lead });
    marks.forEach((mark, order) => {
      const end = order + 1 < marks.length ? marks[order + 1].index : lines.length;
      const body = lines.slice(mark.index, end).join("\n").trim();
      if (!body) return;
      const carry = order === 0 && lead && lead.length < MIN_DOCUMENT_CHARS ? `${lead}\n\n` : "";
      sections.push({ title: mark.heading.title, text: `${carry}${body}` });
    });
    return mergeTinySections(sections).flatMap((section) => (
      section.text.length > maxChars ? splitByParagraph(section.title, section.text, maxChars) : [section]
    ));
  }
  return splitByParagraph(title, text, maxChars);
}

function splitByParagraph(title, text, maxChars) {
  const blocks = text.split(/\n{2,}/);
  const sections = [];
  let buffer = [];
  let size = 0;
  for (const block of blocks) {
    buffer.push(block);
    size += block.length + 2;
    if (size >= maxChars) {
      sections.push({ title: `${title}（${sections.length + 1}）`, text: buffer.join("\n\n").trim() });
      buffer = [];
      size = 0;
    }
  }
  if (buffer.length) sections.push({ title: `${title}（${sections.length + 1}）`, text: buffer.join("\n\n").trim() });
  return sections.length === 1 ? [{ title, text: sections[0].text }] : sections;
}

function mergeTinySections(sections) {
  const merged = [];
  for (const section of sections) {
    const previous = merged.at(-1);
    if (previous && previous.text.length < MIN_DOCUMENT_CHARS) {
      previous.text = `${previous.text}\n\n${section.text}`;
      continue;
    }
    merged.push({ ...section });
  }
  return merged;
}

/**
 * 读一个飞书导出的 zip：里面是 `<文档名>.md` 加一个 `图片和附件/` 目录。
 * 图片以字节返回，由调用方决定进不进资产库。
 */
export function readFeishuArchive(bytes, { fileName = "" } = {}) {
  const files = unzipSync(new Uint8Array(bytes));
  const names = Object.keys(files);
  const markdownName = names.find((name) => MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase()) && !name.includes("/"))
    || names.find((name) => MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (!markdownName) throw new Error(`${fileName || "压缩包"} 里没有 markdown 文件`);
  const images = names
    .filter((name) => name.startsWith(`${FEISHU_ASSET_DIR}/`) && !name.endsWith("/"))
    .map((name) => ({ name, bytes: files[name] }));
  return {
    title: path.basename(markdownName, path.extname(markdownName)),
    text: strFromU8(files[markdownName]),
    images,
  };
}

/**
 * 一份来源文件 → 若干章节。清洗、去死链、切块都在这儿一次做完，
 * 调用方拿到的就是可以直接写进 `book_documents` 的东西。
 */
export function planDocument({ title, text, order = 1 }) {
  const cleaned = stripDeadFeishuImages(cleanFeishuMarkdown(text));
  const dead = findDeadFeishuImages(text).length;
  const sections = splitDocument(title, cleaned);
  return { title, order, dead, sections };
}

/**
 * 这份来源在知识库里算什么。
 *
 * ⚠️ 和「藏书 / 资料」那一位**正交**：那位管正文能不能改（引用可信度），
 * 这位管归置和阅读方式。一门课同样是只读的。
 *
 * 判据用结构而不是文件名：一个目录装着多份文件，本身就说明它是成体系的课程或专栏；
 * 孤立的一份 md / zip 就是一篇文档。
 */
export function classifySource({ title = "", fileCount = 1, own = false } = {}) {
  if (own || /^随笔|^我的/.test(title)) return "文章";
  if (fileCount > 1) return "课程";
  return "文档";
}

/** 目录里的文件按名字排；这批语料用了 `01-` `02-` 前缀，字典序就是课程顺序。 */
export function sortSourceNames(names) {
  return [...names].sort((left, right) => left.localeCompare(right, "zh-Hans-CN", { numeric: true }));
}
