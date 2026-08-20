import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const sources = read("../src/lib/sources.js");
const studio = read("../src/pages/Studio.jsx");
const reader = read("../src/components/ReaderOverlay.jsx");
const organizer = read("../src/components/CollectionOrganizer.jsx");

assert.match(sources, /key:\s*"collections"[\s\S]*?editable:\s*true/);
assert.match(sources, /editTarget:\s*"收件箱"/);
assert.match(sources, /updatedAt:\s*page\.meta\?\.editedAt/);
assert.match(reader, /updatedAt:\s*result\?\.updatedAt/);
assert.match(studio, /updatedAt=\{doc\?\.updatedAt\}/);
assert.match(studio, /if \(status != null\) patch\.badge = status/);
assert.match(studio, /onChanged=\{onCollectionChanged\}/);
assert.match(studio, /onCover=\{activeSourceKey === "collections" \? null : runCover\}/);
assert.match(studio, /onTypeset=\{activeSourceKey === "collections" \? null : openTypeset\}/);
assert.match(organizer, /素材草稿（\{materialDraftsOf\(item\)\.length\} 张）/);
assert.match(organizer, /最多 6 张/);
assert.match(organizer, /updatedAt \|\| item\.raw\.editedAt/);

console.log("✓ 收藏编辑、最新版本状态操作、多素材预览及阅读页动作精简已接通");
