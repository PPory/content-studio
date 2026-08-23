// /api/writing-profile：长期创作设置 + Boujoy 的共享风格/专家清单。

import { fail, json, readJsonBody } from "../lib/http.mjs";
import {
  activeRecord,
  loadWritingProfile,
  loadWritingRecords,
  saveWritingProfile,
} from "../lib/writing-profile.mjs";
import { PLATFORMS } from "../../src/lib/platforms.js";

async function payload(env) {
  const [profile, records] = await Promise.all([loadWritingProfile(), loadWritingRecords(env)]);
  return {
    profile,
    platforms: PLATFORMS,
    ...records,
    style: activeRecord(records.styles, profile.styleId),
  };
}

export const writingProfileRoutes = [
  {
    method: "GET",
    path: "/api/writing-profile",
    async handler({ env, res }) {
      json(res, { ok: true, ...(await payload(env)) });
    },
  },
  {
    method: "POST",
    path: "/api/writing-profile",
    async handler({ env, req, res }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return fail(res, error.message, { status: 400 });
      }
      try {
        await saveWritingProfile(body?.profile || body);
        json(res, { ok: true, ...(await payload(env)) });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
];
