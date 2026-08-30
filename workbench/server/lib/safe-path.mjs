import path from "node:path";

/** 把相对路径限制在指定根目录内，拒绝绝对路径和向上越界。 */
export function safeJoin(root, relative = "") {
  const base = path.resolve(String(root || ""));
  const target = path.resolve(base, String(relative || "").replace(/^[\\/]+/, ""));
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (target !== base && !target.startsWith(prefix)) {
    throw Object.assign(new Error("路径越界，拒绝访问"), { status: 400 });
  }
  return target;
}
