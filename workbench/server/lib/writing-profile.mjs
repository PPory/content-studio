import { WRITING_STYLES } from "./writing-presets.mjs";
import { PLATFORMS } from "../../src/lib/platforms.js";

export const DEFAULT_WRITING_PROFILE = Object.freeze({
  schemaVersion: 1,
  audience: "",
  platform: "公众号",
  styleId: "",
});

const cleanLine = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanPrompt = (value, max = 6_000) => String(value ?? "")
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map((line) => line.replace(/[\t ]+$/g, ""))
  .join("\n")
  .trim()
  .slice(0, max);

export function normalizeWritingProfile(value = {}) {
  const platform = cleanLine(value.platform, 24);
  const styleId = cleanLine(value.styleId, 120);
  return {
    schemaVersion: 1,
    audience: cleanLine(value.audience, 80),
    platform: PLATFORMS.includes(platform) ? platform : DEFAULT_WRITING_PROFILE.platform,
    styleId: /^[\w\-\u4e00-\u9fff]+$/u.test(styleId) ? styleId : "",
  };
}

export function normalizeWritingStyleOverrides(value = {}) {
  const allowed = new Set(WRITING_STYLES.map((item) => item.id));
  return Object.fromEntries(Object.entries(value || {})
    .filter(([id]) => allowed.has(id))
    .map(([id, instructions]) => [id, cleanPrompt(instructions)])
    .filter(([, instructions]) => instructions));
}
