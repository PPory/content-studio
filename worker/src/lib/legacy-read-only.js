const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isLegacyReadOnly(env = {}) {
  return ENABLED_VALUES.has(String(env.MIGRATION_READ_ONLY || "").trim().toLowerCase());
}

export function legacyReadOnlyAllows(request, url = new URL(request.url)) {
  return (request.method === "GET" || request.method === "HEAD") &&
    (url.pathname === "/" || url.pathname.startsWith("/wb/"));
}

export function legacyReadOnlyResponse() {
  return Response.json({ ok: false, code: "legacy_read_only", message: "旧工作区已为本地迁移冻结写入" }, { status: 503 });
}