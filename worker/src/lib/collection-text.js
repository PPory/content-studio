const MIN_FLAT_LENGTH = 480;
const TARGET_PARAGRAPH_LENGTH = 240;

function normalize(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sentenceChunks(text) {
  const chunks = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] || "";
    const chineseBoundary = "。！？；".includes(char);
    const spacedBoundary = ".!?;".includes(char) && (!next || /\s|[”’\"')）]/.test(next));
    if (!chineseBoundary && !spacedBoundary) continue;
    let end = index + 1;
    while (/[”’\"')）]/.test(text[end] || "")) end += 1;
    chunks.push(text.slice(start, end).trim());
    start = end;
    index = end - 1;
  }
  if (start < text.length) chunks.push(text.slice(start).trim());
  return chunks.filter(Boolean);
}

function splitLongChunk(value, maxLength = 420) {
  const parts = [];
  let rest = value.trim();
  while (rest.length > maxLength) {
    const window = rest.slice(0, maxLength + 1);
    const candidates = [window.lastIndexOf("，"), window.lastIndexOf(", "), window.lastIndexOf(" ")];
    const cut = Math.max(...candidates);
    const index = cut >= Math.floor(maxLength * 0.55) ? cut + 1 : maxLength;
    parts.push(rest.slice(0, index).trim());
    rest = rest.slice(index).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function collectionMarkdown(value) {
  const text = normalize(value);
  if (text.length < MIN_FLAT_LENGTH || text.includes("\n")) return text;

  const sentences = sentenceChunks(text).flatMap((chunk) => splitLongChunk(chunk));
  if (sentences.length < 2) return splitLongChunk(text).join("\n\n");

  const paragraphs = [];
  let current = "";
  for (const sentence of sentences) {
    const separator = current && /[A-Za-z0-9.!?;:'\")\]]$/.test(current) && /^[A-Za-z0-9'\"(\[]/.test(sentence) ? " " : "";
    current += separator + sentence;
    if (current.length >= TARGET_PARAGRAPH_LENGTH) {
      paragraphs.push(current.trim());
      current = "";
    }
  }
  if (current) {
    if (paragraphs.length && current.length < 80) paragraphs[paragraphs.length - 1] += current;
    else paragraphs.push(current.trim());
  }
  return paragraphs.join("\n\n");
}
