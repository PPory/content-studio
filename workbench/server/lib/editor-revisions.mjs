const MAX_TEXT = 20_000;
const MAX_INSTRUCTION = 600;
const MAX_GENERATIONS = 10;
const cleanText = (value, max = MAX_TEXT) => String(value || "").slice(0, max);

export function normalizeRevision(item = {}) {
  const id = String(item.id || "").trim();
  if (!/^[0-9A-Za-z_.:-]{8,100}$/.test(id)) {
    throw Object.assign(new Error("修订记录 id 不合法"), { status: 400 });
  }
  const status = ["pending", "adopted", "discarded"].includes(item.status) ? item.status : "pending";
  const mode = ["polish", "correct", "shorten", "expand", "rewrite"].includes(item.mode) ? item.mode : "polish";
  const generations = (Array.isArray(item.generations) ? item.generations : [])
    .slice(-MAX_GENERATIONS)
    .map((entry) => ({ text: cleanText(entry?.text), at: String(entry?.at || new Date().toISOString()) }))
    .filter((entry) => entry.text.trim());
  return {
    id,
    mode,
    label: cleanText(item.label, 40),
    instruction: cleanText(item.instruction, MAX_INSTRUCTION),
    original: cleanText(item.original),
    candidate: cleanText(item.candidate),
    generations,
    status,
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  };
}
