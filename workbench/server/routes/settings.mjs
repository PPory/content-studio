// /api/settings → 设置面板的读、写和自检。
//
// ⚠️ **密钥的值永远不出这个文件。** `GET` 对 `secret: true` 的字段只回一个
// `configured` 布尔，**连掩码都不回**——`sk-****abcd` 那种写法本身就泄露了长度和尾部，
// 而它换来的「看着像那一串」在这里没有任何用处（你不会靠尾部四位来确认 key 对不对，
// 那是自检干的事）。
//
// ⚠️ **写入时空字符串对密钥 = 不改，不是清空。** 面板里的密钥输入框永远是空的
// （因为读不回来），所以「用户没动它」和「用户想清空它」在请求体里长得一模一样。
// 按「清空」处理的话，改一下 XENHO_HOME 就会把 DEEPL_API_KEY 洗掉——
// **不报错、不白屏**，只是翻译从此不工作。清空必须走显式的 `clear` 数组。

import { json, fail, readJsonBody } from "../lib/http.mjs";
import { NAV, SETTINGS, FIELDS, WRITABLE } from "../lib/settings-schema.mjs";
import { envFilePath, updateEnvFile } from "../lib/env-file.mjs";
import { runChecks } from "../lib/settings-check.mjs";

/** 一个字段对外的样子。secret 的分支是这个文件最要紧的一行。 */
function describe(field, env) {
  const raw = String(env[field.key] ?? "");
  const base = {
    key: field.key,
    group: field.group,
    label: field.label,
    hint: field.hint || "",
    // 长说明单独一位：界面上收进「为什么」折叠，默认不铺开
    why: field.why || "",
    // 绑了自检的字段，那条自检画在字段上而不是段尾（见 settings-schema 的说明）
    check: field.check || "",
    placeholder: field.placeholder || "",
    secret: !!field.secret,
    required: !!field.required,
    configured: !!raw.trim(),
  };
  if (field.secret) return base; // ← 值到此为止
  let effective = "";
  try {
    effective = field.effective ? String(field.effective(env)) : "";
  } catch {
    /* 算不出默认值（比如路径拼接失败）不该让整个面板打不开 */
  }
  return { ...base, value: raw, ...(effective && effective !== raw ? { effective } : {}) };
}

export const settingsRoutes = [
  {
    method: "GET",
    path: "/api/settings",
    handler({ env, res }) {
      json(res, {
        ok: true,
        envPath: envFilePath(process.cwd()),
        // 左栏的分组和顺序也从这儿来：前端一个分组名都不写
        nav: NAV,
        fields: SETTINGS.map((f) => describe(f, env)),
      });
    },
  },

  {
    method: "POST",
    path: "/api/settings",
    async handler({ env, req, res }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return fail(res, e.message, { status: 400 });
      }

      const values = body?.values && typeof body.values === "object" ? body.values : {};
      const clear = Array.isArray(body?.clear) ? body.clear : [];
      const changes = {};

      // **白名单，不是黑名单**：
      // 放开任意变量意味着一个笔误就能往 .env 里写进一个谁也不认识的键。
      for (const [key, raw] of Object.entries(values)) {
        if (!WRITABLE.has(key)) continue;
        const value = String(raw ?? "");
        if (FIELDS[key].secret && !value.trim()) continue; // 留空 = 不改（见文件头）
        if (value !== String(env[key] ?? "")) changes[key] = value;
      }
      for (const key of clear) {
        if (WRITABLE.has(key) && String(env[key] ?? "") !== "") changes[key] = "";
      }

      const keys = Object.keys(changes);
      if (!keys.length) return json(res, { ok: true, changed: [], restart: [], envPath: envFilePath(process.cwd()) });

      let out;
      try {
        out = await updateEnvFile(process.cwd(), changes);
      } catch (e) {
        return fail(res, `写 .env 失败：${e.message}`, {
          status: 500,
          hint: "原来那份一个字节都没动。看看这个文件是不是被别的程序占着，或者磁盘满了",
        });
      }

      /**
       * ⚠️ **写 `.env` 会让 Vite 重启整个 dev server。**
       *
       * 它把 `.env` / `.env.local` / `.env.<mode>` 和 vite.config 一起当配置依赖看着，
       * 一变就 `restartServerWithUrls`（vite 8 的 `handleHMRUpdate` 里那段 `isEnv`）。
       * 这是好事——`serveTypeset(env)` 那种在挂中间件时就把路径闭包捕获了的地方，
       * 靠就地改 `env` 是改不动的，重启一遍全对了。
       *
       * 但**前端必须知道这件事**：重启期间接下来的请求会连不上，界面上会闪一句
       * 「本地服务没响应」——看起来就像刚才那次保存失败了，而它其实成功了。
       * 所以响应里带 `restarting`，由面板等服务回来再刷新（见 SettingsDrawer 的 `waitForServer`）。
       *
       * 下面两行仍然要做：重启是异步的，在它真正发生之前进来的请求得读到新值；
       */
      Object.assign(env, changes);

      json(res, {
        ok: true,
        changed: keys,
        restarting: true,
        envPath: out.abs,
        snapshot: !!out.snapshot,
      });
    },
  },

  {
    // POST 而不是 GET：这几条检查会真的往外打网络请求、真的 spawn 进程，
    // 不该被当成一个「读一下」的端点在页面加载时顺手跑掉。
    method: "POST",
    path: "/api/settings/verify",
    async handler({ env, res }) {
      json(res, { ok: true, checks: await runChecks(env) });
    },
  },
];
