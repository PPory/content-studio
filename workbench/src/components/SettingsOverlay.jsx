/**
 * 设置：整屏覆盖层，左栏分类、右栏只画当前那一段。
 *
 * 上一版是六段全铺在一个 660px 抽屉里，每个字段底下还挂着两三行灰字说明——一屏望过去
 * 全是说明文字，字段反而藏在里面。左栏一分之后右边一次只画一段；而且**左栏每项能挂一枚
 * 状态记号**，不用逐段翻就知道哪一段出了事——这才是左导航在这儿真正的价值。
 *
 * ⚠️ **切段不能丢改动。** `draft` 挂在这一层，左栏切的只是「右边画哪一段」。
 * 丢了的话「改 A → 去 B 改一下 → A 白改了」，而且不报错、看不出来。
 * 底下那条动作条常驻，数字是**跨段总数**。
 *
 * ⚠️ **密钥输入框永远是空的**（服务端根本不回值，连掩码都不回）。所以「用户没动它」
 * 和「用户想清空它」在提交时长得一模一样——判据在服务端：**留空 = 不改**，
 * 清空必须走单独的「清除」按钮。这里只是别把它写反。
 *
 * ⚠️ **左栏和字段表都不在这个文件里**，整个从 `GET /api/settings` 渲染出来
 *（真源是 `server/lib/settings-schema.mjs` 的 `NAV` / `SETTINGS`）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api } from "../lib/api.js";
import { ErrorNote, Note } from "./ui.jsx";
import { LocalPrompts, PipelinePrompts } from "./SettingsPrompts.jsx";
import {
  IconAlertCircle,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconLoader2,
  IconRefresh,
  IconSettings,
  IconTrash,
  IconX,
} from "./icons.jsx";

// 自检状态靠**形状**区分，和自绘下拉的 STATE_ICONS 同一条规矩：颜色在这套界面里
// 已经有主人了（黑块=你在这儿、标记黄=我圈中的）。只有 bad 额外吃 --danger——
// 那和 Note 的 danger 是同一件事：真出问题了才配得上一个颜色。
const CHECK_ICONS = { ok: IconCircleCheck, warn: IconAlertCircle, bad: IconCircleX, off: IconCircleDashed };
// 左栏那枚记号取这一段里**最坏**的一条。off 不参与「坏」的排序：可选能力没配是正常态
const SEVERITY = { bad: 3, warn: 2, off: 1, ok: 0 };

/**
 * 等 dev server 重启回来。写 `.env` 会让 Vite 重启（它把 env 文件当配置依赖看着）。
 * **超时也不报错**：保存那一步的响应早就收到了，东西已经写进去了。
 */
async function waitForServer(timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, 400));
  while (Date.now() < until) {
    try {
      await api.config();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

export function SettingsOverlay({ open, onClose, onSaved }) {
  const [data, setData] = useState(null); // /api/settings
  const [promptData, setPromptData] = useState(null); // /api/prompts
  const [active, setActive] = useState("vault");
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({}); // .env 字段的改动
  const [pDraft, setPDraft] = useState({}); // 工作台提示词的改动（点号路径 → 文本）
  const [cleared, setCleared] = useState([]);
  const [checks, setChecks] = useState(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const boxRef = useDialog(open, onClose);

  const load = useCallback(
    () =>
      Promise.all([api.settings(), api.prompts()])
        .then(([s, p]) => {
          setData(s);
          setPromptData(p);
          setDraft({});
          setPDraft({});
          setCleared([]);
        })
        .catch(setError),
    []
  );

  const verify = useCallback(() => {
    setChecking(true);
    api
      .verifySettings()
      .then((d) => setChecks(d.checks))
      // 自检整个挂掉也不该盖住配置本身——那是这一屏真正的主体
      .catch(() => setChecks([]))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaved(null);
    setConfirm(false);
    load();
    // 打开就自动检一遍：这个面板的用处就是**不用你问**就告诉你哪儿不对
    verify();
  }, [open, load, verify]);

  const items = useMemo(() => (data?.nav || []).flatMap((g) => g.items), [data]);
  const current = items.find((i) => i.key === active) || items[0];
  const fieldsOf = useCallback((key) => (data?.fields || []).filter((f) => f.group === key), [data]);
  const checkById = useMemo(() => Object.fromEntries((checks || []).map((c) => [c.id, c])), [checks]);

  // 左栏那枚记号：这一段自检里最坏的一条。没有自检的段不画（不画一个恒为绿的假勾）
  const worstOf = useCallback(
    (item) => {
      const got = (item.checks || []).map((id) => checkById[id]).filter(Boolean);
      if (!got.length) return null;
      return got.reduce((a, b) => (SEVERITY[b.status] > SEVERITY[a.status] ? b : a)).status;
    },
    [checkById]
  );

  if (!open) return null;

  const dirty = Object.keys(draft).length + Object.keys(pDraft).length + cleared.length;

  const touch = () => {
    setConfirm(false); // 改了就退出确认态，别让人在「已确认」的状态下继续编辑
    setSaved(null);
  };
  const setField = (key, value) => {
    touch();
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const setPrompt = (key, value) => {
    touch();
    setPDraft((d) => ({ ...d, [key]: value }));
  };
  const toggleClear = (key) => {
    touch();
    setCleared((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // 提示词先存：它不会触发 dev server 重启，而 .env 会——反过来的话，
      // 重启那一下会把还没发出去的提示词请求打断
      if (Object.keys(pDraft).length) {
        const next = structuredClone(promptData.values);
        for (const [k, v] of Object.entries(pDraft)) {
          const parts = k.split(".");
          let o = next;
          for (const p of parts.slice(0, -1)) o = o[p] ||= {};
          o[parts.at(-1)] = v;
        }
        await api.savePrompts(next);
      }
      let restarting = false;
      if (Object.keys(draft).length || cleared.length) {
        const r = await api.saveSettings(draft, cleared);
        restarting = !!r.restarting;
        setSaved({ changed: r.changed.length + Object.keys(pDraft).length });
      } else {
        setSaved({ changed: Object.keys(pDraft).length });
      }
      setConfirm(false);
      // ⚠️ **写 .env 会让 Vite 重启整个 dev server**，所以这之后不能立刻去打接口——
      // 打了会收到「本地服务没响应」，而那句话会被读成「刚才保存失败了」
      if (restarting) await waitForServer();
      await load();
      onSaved?.();
      verify(); // 改完立刻重检：省掉「我填对了吗」这一次自问
    } catch (e) {
      setError(e);
      setConfirm(false);
    } finally {
      setSaving(false);
    }
  }

  const envPath = data?.envPath || "";
  const envShort = envPath.split(/[\\/]/).slice(-2).join("/") || ".env";

  return (
    /**
     * 一张居中的面板，不是铺满整屏。
     *
     * 铺满那版做出来看图撤了：左栏 208px + 内容上限 760px，在 1440 屏上右边留出
     * 大半屏空白，底部动作条的两个按钮隔着一千多像素分居两头。而这一屏本来就不需要
     * 整屏——需要整屏的是阅读区（正文要吃满宽度）。做成卡片之后还顺带留住了
     * 「背后是哪一页」这条上下文，和抽屉那一版一样。
     */
    <div className="scrim scrim--center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="set-overlay" ref={boxRef} role="dialog" aria-modal="true" aria-label="设置">
      <header className="set-overlay__head">
        <div>
          <span className="eyebrow">SETTINGS</span>
          <h2 className="set-overlay__title">设置</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
          <IconX aria-hidden="true" stroke={1.8} />
        </button>
      </header>

      <div className="set-overlay__body">
        <nav className="set-nav" aria-label="设置分类">
          {(data?.nav || []).map((g) => (
            <div className="set-nav__group" key={g.group}>
              <div className="set-nav__title">{g.group}</div>
              {g.items.map((it) => {
                const worst = worstOf(it);
                const Mark = worst ? CHECK_ICONS[worst] : null;
                return (
                  <button
                    key={it.key}
                    className="set-nav__item"
                    // ⚠️ **两项都叫「流水线」**（一个在「连接」下、一个在「提示词」下），
                    // 文案是对的——那一栏的组名已经把意思分开了。但按文字点的测试选择器
                    // 会撞上，所以留一个稳定的 key 给它们用（同「导航标签一律两个字」
                    // 那条坑：选择器不该依赖会变的字）。
                    data-key={it.key}
                    aria-current={it.key === current?.key}
                    onClick={() => setActive(it.key)}
                  >
                    <span>{it.label}</span>
                    {Mark ? <Mark size={14} stroke={1.7} aria-hidden="true" className={`set-nav__mark is-${worst}`} /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="set-pane">
          {!data ? (
            <div className="field-hint">读取中…</div>
          ) : !current ? null : (
            <>
              <div className="set-pane__head">
                <h3 className="set-pane__title">{current.label}</h3>
                <p className="field-hint">{current.desc}</p>
              </div>

              <ErrorNote error={error} what="设置" />
              {saved ? <SavedNote saved={saved} /> : null}

              {current.kind === "env" ? (
                <>
                  {fieldsOf(current.key).map((f) => (
                    <Field
                      key={f.key}
                      field={f}
                      draft={draft[f.key]}
                      cleared={cleared.includes(f.key)}
                      onChange={(v) => setField(f.key, v)}
                      onToggleClear={() => toggleClear(f.key)}
                    />
                  ))}
                  {(current.checks || []).map((id) => (
                    <CheckRow key={id} check={checkById[id]} loading={checking} />
                  ))}
                </>
              ) : current.kind === "prompts-local" ? (
                <LocalPrompts data={promptData} draft={pDraft} onChange={setPrompt} guard={promptData?.guard} />
              ) : (
                <PipelinePrompts />
              )}
            </>
          )}
        </div>
      </div>

      {/* 动作条固定在底部：按钮永远在同一个位置，肌肉记忆才立得住。
          **数字是跨段总数**——改了三段之后底下写「保存这 1 项」是骗人的 */}
      <footer className="set-overlay__foot">
        <button className="btn btn-sm" onClick={verify} disabled={checking}>
          <IconRefresh aria-hidden="true" stroke={1.8} />
          {checking ? "检查中…" : "重新检查"}
        </button>

        {current?.kind === "prompts-worker" ? (
          <span className="field-hint set-overlay__note">
            这一段在上面单独保存——它写的是 content-pipeline 的文件，而且要部署一次才生效。
            {dirty ? `另有 ${dirty} 项设置改动没保存。` : ""}
          </span>
        ) : null}

        {/**
         * 点两下才写。改 .env 是不可逆的一步，而第二下的按钮上**直接写东西去哪**，
         * 不写「确定吗」——后者既没有信息量，也让人不敢按。
         *
         * ⚠️ **在流水线提示词那一段，没改动时整个不画这个按钮。** 那一段自己头上已经有一个
         * 「没有改动」了（管的是当前那个 .md），底下再来一个一模一样的灰按钮，
         * 两个长得一样、管的却是两回事——看图才发现的。
         */}
        {current?.kind === "prompts-worker" && !dirty ? null : confirm ? (
          <>
            <button className="btn" onClick={() => setConfirm(false)} disabled={saving}>
              取消
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving} title={envPath}>
              <IconSettings aria-hidden="true" stroke={1.8} />
              {saving ? "写入中…" : `写入 ${envShort}`}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => setConfirm(true)} disabled={!dirty || saving}>
            {dirty ? `保存这 ${dirty} 项改动` : "没有改动"}
          </button>
        )}
      </footer>
    </div>
    </div>
  );
}

/**
 * 保存回执。**要说清「已经生效了」**——写 `.env` 会让本地服务重启一次，
 * 那期间界面上可能闪一下加载态，不解释的话人会以为刚才那一下没成。
 */
function SavedNote({ saved }) {
  if (!saved.changed) return <Note title="没有需要写入的改动">填的值和现在的一样。</Note>;
  return (
    <Note title={`已保存 ${saved.changed} 项，已经生效`}>
      改之前那一版留了快照（单独存着，因为 <code>.env</code> 里有密钥，<b>不会</b>跟着导出包走）。
      本地服务顺带重启了一次，不用你动手。
    </Note>
  );
}

function Field({ field, draft, cleared, onChange, onToggleClear }) {
  const value = draft ?? field.value ?? "";
  return (
    <div className="set-field">
      <label className="set-field__label" htmlFor={`set-${field.key}`}>
        {field.label}
        {field.required ? <em className="set-field__req">必填</em> : null}
        <code className="set-field__key">{field.key}</code>
      </label>

      <div className="set-field__row">
        <input
          id={`set-${field.key}`}
          className="set-field__input"
          // 密钥用 password：这台机器上会录屏、会共享桌面，而**核对 key 对不对靠的是
          // 底下那条自检，不是肉眼比字符串**——所以不做「显示明文」的眼睛按钮，
          // 那只会多一个手滑就把密钥摊在屏幕上的开关
          type={field.secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          value={field.secret ? (draft ?? "") : value}
          placeholder={
            field.secret
              ? cleared
                ? "保存后清空"
                : field.configured
                  ? "已配置（留空则不改）"
                  : "未配置"
              : field.placeholder || ""
          }
          onChange={(e) => onChange(e.target.value)}
        />
        {/* 清空必须是个显式动作。密钥框读不回值，靠「留空」表示清空的话，
            改一下别的字段就会顺手把 key 洗掉，而且不报错 */}
        {field.secret && field.configured ? (
          <button
            className="sysrow__btn"
            onClick={onToggleClear}
            aria-pressed={cleared}
            title={cleared ? "撤销清除" : "保存时把这个密钥清空"}
          >
            <IconTrash size={14} stroke={1.7} aria-hidden="true" />
            {cleared ? "撤销清除" : "清除"}
          </button>
        ) : null}
      </div>

      {field.hint ? <div className="field-hint">{field.hint}</div> : null}
      {field.effective ? (
        <div className="field-hint set-field__eff">
          留空时用：<code>{field.effective}</code>
        </div>
      ) : null}
      {/* 长说明收进折叠，**默认收起**。踩过的坑一条不删，但不该占着一屏 */}
      {field.why ? (
        <details className="set-why">
          <summary>为什么</summary>
          <p>{field.why}</p>
        </details>
      ) : null}
    </div>
  );
}

/** 一条自检。**没结果时说「检查中」，不画一个假的绿勾。** */
function CheckRow({ check, loading }) {
  if (!check) {
    return (
      <div className="set-check set-check--wait">
        <IconLoader2 size={15} stroke={1.7} aria-hidden="true" className="spinning" />
        <span className="set-check__text">{loading ? "检查中…" : "这一项没检成"}</span>
      </div>
    );
  }
  const Icon = CHECK_ICONS[check.status] || IconCircleDashed;
  return (
    <div className={`set-check set-check--${check.status}`}>
      <Icon size={15} stroke={1.7} aria-hidden="true" />
      <span className="set-check__label">{check.label}</span>
      <span className="set-check__text">{check.text}</span>
      {/* hint 是**下一步动作**，不是错误详情。它才是这一行存在的理由 */}
      {check.hint ? <span className="set-check__hint">{check.hint}</span> : null}
    </div>
  );
}
