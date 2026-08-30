/**
 * 设置：整屏覆盖层，左栏分类、右栏只画当前那一段。
 *
 * 上一版是六段全铺在一个 660px 抽屉里，每个字段底下还挂着两三行灰字说明——一屏望过去
 * 全是说明文字，字段反而藏在里面。左栏一分之后右边一次只画一段；而且**左栏每项能挂一枚
 * 状态记号**，不用逐段翻就知道哪一段出了事——这才是左导航在这儿真正的价值。
 *
 * ⚠️ **切段不能丢改动。** `.env` 字段和工作台提示词的 `draft` 挂在这一层，
 * 左栏切的只是「右边画哪一段」。丢了的话「改 A → 去 B 改一下 → A 白改了」，
 * 而且不报错、看不出来。底下那条动作条常驻，数字是**跨段总数**。
 *
 * ⚠️ **自带状态的那三段（模型 / 我的创作 / 流水线提示词）靠「访问过就留着」保命。**
 * 它们各自 fetch、各自存草稿，`draft` 那条规矩管不到；上一版是条件渲染，
 * 切走就卸载——粘了一半的模型名、刚弹出来的校验错误、改到一半的提示词全没了，
 * 回来还要再等一次「读取中…」。现在**访问过的段一直留在 DOM 里**，只是用 `hidden`
 * 藏起来（`hidden` 同时管住了三件事：不显示、Tab 走不进去、读屏读不到——
 * 只写 `opacity: 0` 的话它还在 Tab 序列里，那正是 `use-dialog.js` 一直在防的那类问题）。
 *
 * **没访问过的段仍然惰性**：它们一挂载就会去打接口（模型清单、写作画像、提示词目录），
 * 一进设置就全量预热等于每次开面板都白打三四个请求。
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
import { LocalPrompts } from "./SettingsPrompts.jsx";
import { SettingsWritingProfile } from "./SettingsWritingProfile.jsx";
import {
  IconAlertCircle,
  IconArrowBackUp,
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
 * **自己带保存按钮的那几段**：它们写的不是本机 `.env`，所以不跟着底部那条动作条走。
 *
 * ⚠️ **收成一个常量，别再散着写三遍 `kind === "..."`。** 这个判断原来在页脚出现了
 * 四次（三条说明各一次 + 保存按钮的显示条件一次），加一段自带保存的就要改四处，
 * 而漏掉哪一处都不报错——只是屏幕上少一句话，或者多一颗管不着这一段的保存按钮。
 */
const SELF_SAVING = new Set(["writing-profile"]);

/**
 * 等 dev server 重启回来。写 `.env` 会让 Vite 重启（它把 env 文件当配置依赖看着）。
 * **超时也不报错**：保存那一步的响应早就收到了，东西已经写进去了。
 */
async function waitForServer(timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, 400));
  while (Date.now() < until) {
    try {
      await api.status();
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
  const [active, setActive] = useState("writing-profile");
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({}); // .env 字段的改动
  const [pDraft, setPDraft] = useState({}); // 工作台提示词的改动（点号路径 → 文本）
  const [cleared, setCleared] = useState([]);
  const [checks, setChecks] = useState(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  /**
   * 访问过哪几段。**只增不减**（在这一次打开期间），用来决定哪些面板留在 DOM 里。
   * 每次重新打开面板会清空——不清的话，上次翻过的段会在打开的瞬间一起挂载、
   * 一起打接口，而这一次你可能只是来改一个路径。
   */
  const [visited, setVisited] = useState([]);
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
    setVisited([]);
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

  /**
   * 记下这一段被访问过。
   * ⚠️ **跟着 `current?.key` 走而不是 `active`**：数据还没回来时 `items` 是空的、
   * `current` 是 undefined，而 `active` 已经有值了——按 `active` 记的话会把一个
   * 还没有对应面板的 key 记进去，然后渲染出一个空壳。
   */
  useEffect(() => {
    if (!open || !current?.key) return;
    setVisited((v) => (v.includes(current.key) ? v : [...v, current.key]));
  }, [open, current?.key]);

  if (!open) return null;

  /**
   * 画一段的正文。**按传进来的 `item` 画，不看 `current`**——这一层现在会把访问过的
   * 每一段都画出来（只藏不卸），拿 `current` 的话所有段画的都是同一份内容。
   */
  function renderPane(item) {
    if (item.kind === "env") {
      const bound = new Set(fieldsOf(item.key).map((f) => f.check).filter(Boolean));
      return (
        <>
          {fieldsOf(item.key).map((f) => (
            <Field
              key={f.key}
              field={f}
              draft={draft[f.key]}
              cleared={cleared.includes(f.key)}
              onChange={(v) => setField(f.key, v)}
              onToggleClear={() => toggleClear(f.key)}
              check={f.check ? checkById[f.check] : null}
              checking={checking}
            />
          ))}
          {/* 段尾只剩**没有字段可挂**的那几条（对话引擎压根没有输入框；
              Worker 和 Firecrawl 各自跨两个字段）。有字段的都收进标题旁边那枚点了——
              三条「已配」并排堆在段尾时，每一条说的话都等于没说。 */}
          {(item.checks || [])
            .filter((id) => !bound.has(id))
            .map((id) => (
              <CheckRow key={id} check={checkById[id]} loading={checking} />
            ))}
        </>
      );
    }
    if (item.kind === "writing-profile") return <SettingsWritingProfile onSaved={onSaved} />;
    if (item.kind === "prompts-local") {
      return <LocalPrompts data={promptData} draft={pDraft} onChange={setPrompt} guard={promptData?.guard} />;
    }
    return null;
  }

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

  /**
   * 这一段有没有改动 / 把这一段的改动撤掉。
   *
   * ⚠️ **是「撤销改动」不是「恢复默认」。** 抄的那个 macOS 应用每段都有一颗
   * `Restore Defaults`，但它那些是字号、语言这类**有默认值**的偏好；
   * 我们这几段大半是 API key 和路径——**一把密钥没有「默认值」**，
   * 唯一能「恢复」的动作是清空，而那是破坏性的，已经有每个字段自己的「清除」管着。
   * 真正有用、而且每一段都定义得清楚的是：把我刚才改的放回去。
   *
   * ⚠️ **按段算，不按全局算。** 底下那颗保存是跨段的（数字是总数），
   * 而这一颗只管眼前这一段——两者算同一个范围的话，「撤销」会把你在别的段
   * 改好的东西一起吞掉，而屏幕上看不出来。
   */
  const paneKeys = (item) => (item?.kind === "env" ? fieldsOf(item.key).map((f) => f.key) : []);
  const paneDirty = (item) => {
    if (!item) return 0;
    if (item.kind === "prompts-local") return Object.keys(pDraft).length;
    const keys = paneKeys(item);
    return keys.filter((k) => k in draft).length + keys.filter((k) => cleared.includes(k)).length;
  };
  const revertPane = (item) => {
    touch();
    if (item.kind === "prompts-local") {
      setPDraft({});
      return;
    }
    const keys = new Set(paneKeys(item));
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.has(k))));
    setCleared((c) => c.filter((k) => !keys.has(k)));
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

  // 这一段自己带保存按钮吗（写的不是本机 .env）。判断收在 `SELF_SAVING` 一处，
  // 页脚那两处都问它——原来是同一串 `kind === "..."` 抄了四遍
  const selfSaving = SELF_SAVING.has(current?.kind);

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
                <div className="set-pane__heading">
                  <h3 className="set-pane__title">{current.label}</h3>
                  {/**
                    * ⚠️ **只在这一段真有改动时才画。** 一颗永远在那儿、大半时候点了
                    * 没反应的「撤销」，和一个灰着的按钮一样：它占着位置却不回答任何问题。
                    */}
                  {paneDirty(current) ? (
                    <button
                      type="button"
                      className="btn btn-sm set-pane__revert"
                      onClick={() => revertPane(current)}
                      title="把这一段改的放回保存前的样子（不影响别的段）"
                    >
                      <IconArrowBackUp aria-hidden="true" stroke={1.8} />
                      撤销这一段（{paneDirty(current)}）
                    </button>
                  ) : null}
                </div>
                <p className="field-hint">{current.desc}</p>
                {/**
                  * 「存到哪、什么时候生效」。⚠️ **它必须紧挨着它说的那件事。**
                  * 上一版这句话是页脚里三个硬编码的 `<span>`：只覆盖 12 段里的 3 段，
                  * 而且离面板抬头隔着大半屏——读到「已保存」的人不会低头去页脚
                  * 找「其实还要部署一次」。真源在 `settings-schema.mjs` 的 `applies`。
                  */}
                {current.applies ? (
                  <p className="set-pane__applies">
                    <IconAlertCircle size={13} stroke={1.8} aria-hidden="true" />
                    {current.applies}
                  </p>
                ) : null}
              </div>

              <ErrorNote error={error} what="设置" />
              {saved ? <SavedNote saved={saved} /> : null}
            </>
          )}

          {/**
            * ⚠️ **访问过的段全留在 DOM 里，只把不当前的那些 `hidden` 掉。**
            *
            * 用 `hidden` 而不是 `display: none` 的 class，也不是 `opacity: 0`：
            * 这一个属性同时管住「不显示 + Tab 走不进去 + 读屏读不到」三件事，
            * 而 `opacity: 0` 只管住第一件——藏起来的那几段的输入框仍然在 Tab 序列里，
            * 那正是 `use-dialog.js` 一直在防的那类问题（看不见但按得到）。
            *
            * 没访问过的段**不在这个数组里**，所以仍然是惰性的：它们一挂载就会去打接口
            *（模型清单、写作画像、提示词目录），一进设置就全量预热等于每次白打三四个请求。
            *
            * ⚠️ **代价写在这儿：`.set-pane` 底下从此可能有同名元素的多份拷贝。**
            * 任何 `document.querySelector(".set-pane .xxx")` 都可能命中一个**藏起来的**那份——
            * 拿到的元素是真的、也确实在 DOM 里，只是永远不可见。冒烟测试已经栽过一次
            *（等一个明明画着的元素，超时 20 秒中断整轮）。要按选择器找东西的话，
            * 一律带上 `.set-pane__slot:not([hidden])`。
            */}
          {data
            ? items
                .filter((it) => visited.includes(it.key))
                .map((it) => (
                  <div key={it.key} className="set-pane__slot" hidden={it.key !== current?.key}>
                    {renderPane(it)}
                  </div>
                ))
            : null}
        </div>
      </div>

      {/* 动作条固定在底部：按钮永远在同一个位置，肌肉记忆才立得住。
          **数字是跨段总数**——改了三段之后底下写「保存这 1 项」是骗人的 */}
      <footer className="set-overlay__foot">
        <button className="btn btn-sm" onClick={verify} disabled={checking}>
          <IconRefresh aria-hidden="true" stroke={1.8} />
          {checking ? "检查中…" : "重新检查"}
        </button>

        {/**
          * ⚠️ **这三段原来在这儿各挂一句「它写的是哪儿、什么时候生效」，撤了。**
          * 那句话搬进了面板抬头（`applies`，真源在 `settings-schema.mjs`）：
          * 它描述的是上面那一段，读的人不会低头来页脚找。
          * 页脚只留**这条动作条自己的事**——你在别的段还欠着几项没保存。
          */}
        {selfSaving ? (
          <span className="field-hint set-overlay__note">
            这一段在上面单独保存。{dirty ? `另有 ${dirty} 项设置改动没保存。` : ""}
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
        {selfSaving && !dirty ? null : confirm ? (
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

function Field({ field, draft, cleared, onChange, onToggleClear, check, checking }) {
  const value = draft ?? field.value ?? "";
  // 出问题了才占地方。ok / off 只在标题旁边留一枚点；bad / warn 底下另起完整一条，
  // 因为那时候要看的是**下一步做什么**，而一个要悬停才找得到的提示等于没有
  const loud = !!check && (check.status === "bad" || check.status === "warn");
  return (
    <div className="set-field">
      <label className="set-field__label" htmlFor={`set-${field.key}`}>
        {field.label}
        {field.check ? <FieldDot check={check} loading={checking} /> : null}
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

      <HintLine hint={field.hint} why={field.why} />
      {field.effective ? (
        <div className="field-hint set-field__eff">
          留空时用：<code>{field.effective}</code>
        </div>
      ) : null}

      {loud ? <CheckRow check={check} loading={checking} /> : null}
    </div>
  );
}

/**
 * 标题旁边那枚点。**配好了就只有这一枚。**
 *
 * 上一版在字段底下留一行「✓ 已配（免费版，走 api-free.deepl.com）」。它说的和输入框里
 * 那句「已配置（留空则不改）」是同一件事，只是多占一行——而一个字段底下同时挂着
 * 说明、「为什么」和这一行时，三行灰字就把字段本身埋了。
 *
 * 结论和 hint 进 `title` / `aria-label`：那是**核对信息**，想起来才看一眼。
 * 出问题的两档（bad / warn）不靠它——那时候字段底下另有完整一条。
 *
 * 用点不用图标，是因为侧栏底下那句「流水线已连接」用的就是同一枚 `.dot`——
 * 界面上「这东西通没通」已经有一套现成的说法了，不该在设置面板里另发明一种。
 */
function FieldDot({ check, loading }) {
  if (!check) {
    const label = loading ? "检查中…" : "这一项没检成";
    return <span className="dot set-field__dot set-field__dot--wait" role="img" aria-label={label} title={label} />;
  }
  // hint 另起一行，不套括号：结论里本来就有括号（「已配（免费版…）」），
  // 再包一层就成了「（…（…））」
  const label = `${check.label}：${check.text}` + (check.hint ? `\n${check.hint}` : "");
  return (
    <span
      className={`dot set-field__dot dot-${check.status === "ok" ? "ok" : check.status === "bad" ? "bad" : check.status === "warn" ? "warn" : "off"}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

/**
 * 一行说明，长的那段就地展开。
 *
 * ⚠️ **「为什么」不另起一行**，挂在说明句尾。单独占一行时，一个字段底下就是
 * 「说明 / 为什么 / 自检」三行灰字——上一版正是这么变成一大坨的。挂在句尾之后它不多占
 * 地方，而且整句可点，比一个孤零零的「▸ 为什么」更像个入口。
 */
function HintLine({ hint, why }) {
  if (!hint && !why) return null;
  if (!why) return <div className="field-hint">{hint}</div>;
  return (
    <details className="set-why">
      <summary className="field-hint">
        {hint}
        <span className="set-why__more">为什么</span>
      </summary>
      <p>{why}</p>
    </details>
  );
}

/**
 * 一条自检。**没结果时说「检查中」，不画一个假的绿勾。**
 *
 * 两种重量，按「这一刻要不要占地方」分：
 *   - `bad` / `warn` → 完整一条（灰块 + 名字 + 结论 + **下一步**）。出事时该显眼。
 *   - `ok` / `off`   → 一行小字，不画块面。结论本身没几个字，套个灰盒子只是噪音。
 *
 * 两个地方会画它：**绑了字段的**只在出问题时画（通了的那两档由标题旁边那枚点带走，
 * 见 `FieldDot`）；**没字段可挂的**画在段尾——`agent`（对话引擎）压根没有输入框，
 * `worker` / `firecrawl` 各自跨两个字段，绑到其中一个就等于把红叉指到无辜的框上。
 */
function CheckRow({ check, loading }) {
  if (!check) {
    return (
      <div className="set-check set-check--wait set-check--flat">
        <IconLoader2 size={15} stroke={1.7} aria-hidden="true" className="spinning" />
        <span className="set-check__text">{loading ? "检查中…" : "这一项没检成"}</span>
      </div>
    );
  }
  const Icon = CHECK_ICONS[check.status] || IconCircleDashed;
  const loud = check.status === "bad" || check.status === "warn";
  return (
    <div className={`set-check set-check--${check.status}${loud ? "" : " set-check--flat"}`}>
      <Icon size={15} stroke={1.7} aria-hidden="true" />
      <span className="set-check__label">{check.label}</span>
      <span className="set-check__text">{check.text}</span>
      {/* hint 是**下一步动作**，不是错误详情。它才是这一条存在的理由 */}
      {check.hint ? <span className="set-check__hint">{check.hint}</span> : null}
    </div>
  );
}
