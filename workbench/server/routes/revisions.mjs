import { fail, json, readJsonBody } from "../lib/http.mjs";
import { listEditorRevisions, moveEditorRevisions, saveEditorRevision } from "../lib/editor-revisions.mjs";

export const revisionRoutes = [
  {
    method: "GET",
    path: "/api/revisions",
    async handler({ res, url }) {
      try {
        json(res, { ok: true, items: await listEditorRevisions(url.searchParams.get("scope")) });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500 });
      }
    },
  },
  {
    method: "POST",
    path: "/api/revisions",
    async handler({ req, res }) {
      try {
        const body = await readJsonBody(req);
        json(res, { ok: true, items: await saveEditorRevision(body.scope, body.item) });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500 });
      }
    },
  },
  {
    method: "POST",
    path: "/api/revisions/move",
    async handler({ req, res }) {
      try {
        const body = await readJsonBody(req);
        json(res, { ok: true, items: await moveEditorRevisions(body.from, body.to) });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500 });
      }
    },
  },
];
