import {
  IconCheck, IconChevronDown, IconCornerDownLeft, IconFileText, IconPlayerStopFilled, IconPlus, IconShieldCheck, IconX,
  IconModelAnthropic, IconModelDeepseek, IconModelGeneric, IconModelGoogle, IconModelMeta,
  IconModelMinimax, IconModelMistral, IconModelMoonshot, IconModelOpenai, IconModelQwen,
  IconModelXai, IconModelZhipu,
} from "../icons.jsx";
import { groupModelsByBrand, modelBrand } from "../../lib/model-brands.js";

/** 厂商 key → 标志。判据（谁是哪家）在 model-brands.js，这里只负责画。 */
const BRAND_ICONS = {
  anthropic: IconModelAnthropic,
  openai: IconModelOpenai,
  google: IconModelGoogle,
  xai: IconModelXai,
  deepseek: IconModelDeepseek,
  moonshot: IconModelMoonshot,
  zhipu: IconModelZhipu,
  qwen: IconModelQwen,
  minimax: IconModelMinimax,
  meta: IconModelMeta,
  mistral: IconModelMistral,
};

function ModelGlyph({ id, provider = "" }) {
  const brand = modelBrand(id, provider);
  const BrandIcon = BRAND_ICONS[brand.key] || IconModelGeneric;
  return <span className="assistant-model-glyph" data-brand={brand.key} aria-hidden="true"><BrandIcon /></span>;
}

export function AssistantComposer({
  pendingAttachments,
  busy,
  uploadError,
  inputRef,
  input,
  scope,
  surface,
  permissionOpen,
  permissionRef,
  permissionModes,
  permissionMode,
  modePending,
  menu,
  menuQuery,
  filteredMenuItems,
  menuIndex,
  modelPending,
  fileRef,
  uploading,
  models,
  model,
  modelNotice,
  loading,
  onSubmit,
  onDismissUploadError,
  onInputChange,
  onInputKeyDown,
  onChoosePermissionMode,
  onCloseMenu,
  onMenuIndex,
  onChooseMenuItem,
  onUploadFile,
  onTogglePermission,
  onToggleModel,
  onStop,
  context = null,
}) {
  const overlay = surface === "overlay";
  /**
   * ⚠️ **模型和权限不是同一类东西，别再共用一个开关。**
   *
   * - **模型**是「这一条用哪个发出去」——发送动作的一部分。**每个输入框都要有**，
   *   包括项目协作栏和阅读栏：在哪儿写字，就在哪儿决定用哪个模型发出去，
   *   不该为了换个模型先跳去完整工作区。
   * - **权限**是「这一轮 AI 能碰什么」——带后果的会话级设置，设一次管很久。
   *   留在完整工作区里设，侧栏不重复暴露（也避免在窄栏里再挤一个下拉）。
   */
  const showModel = true;
  const showPermission = scope === "global" && surface === "page";
  return <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    {/**
      * ⚠️ **「这一轮 AI 读到什么」住在输入框里，不在顶上那条 header 里。**
      *
      * 你正要打字的地方，才是需要知道它读什么的时刻。上一版把它挂在 header：
      * 视线在最下面写字，而「读的是全文还是我选中的那段」写在一栏之外的最上面，
      * 每次都要抬头确认一次。Notion 把这颗芯片放进输入框本身，是同一个判断。
      *
      * 只有一处，不重复：header 那边已经撤掉了。
      */}
    {context ? <div className="assistant-composer__context">{context}</div> : null}
    {pendingAttachments.length && !busy ? <div className="assistant-attachments">{pendingAttachments.slice(-4).map((item) => <span key={item.id}>{item.kind === "image" ? (item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="assistant-attachment-image">▧</span>) : <IconFileText aria-hidden="true" />}<span>{item.name}</span></span>)}</div> : null}
    {uploadError ? <div className="assistant-composer__notice" role="status"><span>{uploadError}</span><button type="button" onClick={onDismissUploadError} aria-label="关闭"><IconX aria-hidden="true" /></button></div> : null}
    <textarea ref={inputRef} data-autofocus={overlay ? "true" : undefined} value={input} onChange={onInputChange} onKeyDown={onInputKeyDown} placeholder={scope === "global" ? "问任何问题，或直接输入本地项目路径" : "问当前内容"} rows="2" disabled={busy} />
    {menu && menu !== "models" ? <div className="assistant-command-menu" role="menu">
      <header><span>{menu === "experts" ? "选择专家" : "选择 Skill"}{menuQuery ? <em>“{menuQuery}”</em> : null}</span><button type="button" onClick={onCloseMenu}><IconX aria-hidden="true" /></button></header>
      {filteredMenuItems.length ? filteredMenuItems.map((item, index) => <button type="button" role="menuitem" aria-current={index === menuIndex ? "true" : undefined} key={item.id} onMouseEnter={() => onMenuIndex(index)} onClick={() => onChooseMenuItem(item)}><span className="assistant-command-menu__mark">{menu === "experts" ? "@" : "/"}</span><span><b>{item.label}</b><small>{item.hint}</small></span></button>) : <p className="assistant-command-menu__empty">没有匹配项</p>}
    </div> : null}
    <footer>
      {/**
        * ⚠️ **模型贴着发送键，权限留在左边。这两个不是同一类东西，别再按「都是设置」归成一组。**
        *
        * 曾经把模型也挪到左边，理由是「两个低频开关不该分居两端」。看着整齐，用着不对：
        * - **权限**是会话级的——这一轮谈话 AI 能碰什么，设一次管很久，属于「进门时定的规矩」。
        * - **模型**是发送级的——「这一条用哪个模型发出去」，它是发送动作的一部分，
        *   用户在按下发送前的最后一眼往往是确认它。放在发送键旁边，读起来是一句话；
        *   放在左端，就要在按发送前把视线甩到对面再甩回来。
        *
        * Codex 桌面端也是这个分法（左：附件 + 功能入口，右：模型 + 语音 + 发送）。
        */}
      <div className="assistant-composer__left">
        <><input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.md,.markdown,.txt,.csv,.json,.xml,.html,.htm,.yaml,.yml,.js,.jsx,.ts,.tsx,.css" onChange={onUploadFile} /><button type="button" className="assistant-composer__attach" title={uploading ? "正在读取附件" : "添加图片或文件"} aria-label={uploading ? "正在读取附件" : "添加图片或文件"} onClick={() => fileRef.current?.click()} disabled={uploading}><IconPlus aria-hidden="true" /></button></>
        {/* ⚠️ **菜单挂在按钮自己的定位父级里，不挂在整个输入器上。**
            上一版它是 textarea 的兄弟节点、`bottom` 相对整个 `.assistant-composer` 算——
            于是菜单底边贴的是**输入器顶部**，而触发它的按钮在输入器**左下角**，
            两者中间隔着整条输入框的高度，看着就是「菜单和按钮分家了」。
            浮层必须从自己的触发器长出来，这条在模型选择器上已经做对了一次。 */}
        {showPermission ? <div className="assistant-permission-picker">
          <button type="button" className="assistant-composer__access" title="权限" onClick={onTogglePermission} aria-expanded={permissionOpen} disabled={busy || modePending}><IconShieldCheck aria-hidden="true" /><span>权限 {permissionModes.find((item) => item.id === permissionMode)?.label || "日常"}</span><IconChevronDown aria-hidden="true" /></button>
          {permissionOpen ? <div className="assistant-permission-menu" ref={permissionRef} role="menu" aria-label="选择权限">
            {permissionModes.map((item) => <button type="button" role="menuitemradio" key={item.id} aria-checked={item.id === permissionMode} onClick={() => onChoosePermissionMode(item.id)} disabled={busy || modePending}><IconShieldCheck aria-hidden="true" /><span><b>{item.label}</b><small>{item.description}</small></span>{item.id === permissionMode ? <IconCheck aria-hidden="true" /> : null}</button>)}
          </div> : null}
        </div> : null}
      </div>
      <div className="assistant-composer__right">
        {showModel ? <div className="assistant-model-picker">
          <button type="button" className="assistant-composer__model" title={modelNotice || "从当前接口返回的可用模型中选择"} onClick={onToggleModel} aria-expanded={menu === "models"} disabled={busy || modelPending}><ModelGlyph id={model} provider={models.find((item) => item.id === model)?.ownedBy} /><b>{models.find((item) => item.id === model)?.name || model || "默认模型"}</b><IconChevronDown aria-hidden="true" /></button>
          {menu === "models" ? <div className="assistant-command-menu assistant-command-menu--models" role="menu">
            <header><span>选择模型</span><button type="button" onClick={onCloseMenu}><IconX aria-hidden="true" /></button></header>
            {/* ⚠️ **同一家连着排，并且写出厂商名。**
                上一版直接用接口返回的顺序，于是 gpt / claude / gpt / glm / claude 交叉出现——
                换模型时用户找的几乎总是「同一家的另一档」，穿插排列等于每次把整列读一遍。
                组内保持接口原顺序（那通常已经是厂商自己的新旧顺序），不自作主张重排。
                键盘导航仍然走扁平的 `menuIndex`，所以这里要记住每一项的全局序号。 */}
            {filteredMenuItems.length ? (() => {
              let flat = -1;
              return groupModelsByBrand(filteredMenuItems).map((group) => <section className="assistant-model-group" key={group.key}>
                <h4>{group.label}</h4>
                {group.items.map((item) => {
                  const index = (flat += 1);
                  return <button type="button" role="menuitem" aria-current={index === menuIndex ? "true" : undefined} key={item.id} onMouseEnter={() => onMenuIndex(index)} onClick={() => onChooseMenuItem(item)} disabled={modelPending}><span className="assistant-command-menu__mark"><ModelGlyph id={item.id} provider={item.provider} /></span><span><b>{item.label}</b>{item.hint ? <small>{item.hint}</small> : null}</span>{item.id === model ? <IconCheck className="assistant-model-current" aria-label="当前模型" /> : null}</button>;
                })}
              </section>);
            })() : <p className="assistant-command-menu__empty">暂时没有可用模型</p>}
          </div> : null}
        </div> : null}
        {/* 发送键**永远看得见**。上一版空输入时 `opacity: .28`，
            用户看不出那儿有个按钮，也就不知道 Enter 能发——空态用静止的浅底，
            有内容才翻成实心黑，状态差别靠颜色说，不靠「有没有」说。 */}
        {busy ? <button type="button" className="assistant-send assistant-send--stop" onClick={onStop} aria-label="停止生成" title="停止生成"><IconPlayerStopFilled aria-hidden="true" /></button> : <button type="submit" className="assistant-send" disabled={(!input.trim() && !pendingAttachments.length) || loading || uploading} aria-label="发送" title="发送（Enter）"><IconCornerDownLeft aria-hidden="true" /></button>}
      </div>
    </footer>
  </form>;
}
