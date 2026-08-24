export function documentVersion(document = {}) {
  const text = `${String(document.title || "")}\n${String(document.body || "")}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}
