import {
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandX,
  IconCube,
  IconFish,
  IconLetterA,
  IconLetterK,
  IconLetterQ,
  IconLetterZ,
} from "@tabler/icons-react";
import { IconCheck, IconChevronDown, IconFileText, IconPlus, IconSend, IconShieldCheck, IconX } from "../icons.jsx";

function modelBrand(id = "", provider = "") {
  const value = `${id} ${provider}`.toLowerCase();
  if (/grok|\bxai\b/.test(value)) return { key: "grok", Icon: IconBrandX };
  if (/gemini|google/.test(value)) return { key: "gemini", Icon: IconBrandGoogle };
  if (/claude|anthropic/.test(value)) return { key: "claude", Icon: IconLetterA };
  if (/deepseek/.test(value)) return { key: "deepseek", Icon: IconFish };
  if (/kimi|moonshot/.test(value)) return { key: "kimi", Icon: IconLetterK };
  if (/glm|zhipu/.test(value)) return { key: "glm", Icon: IconLetterZ };
  if (/qwen|alibaba/.test(value)) return { key: "qwen", Icon: IconLetterQ };
  if (/gpt|openai|\bo[134]\b/.test(value)) return { key: "openai", Icon: IconBrandOpenai };
  return { key: "other", Icon: IconCube };
}

function ModelGlyph({ id, provider = "" }) {
  const brand = modelBrand(id, provider);
  const BrandIcon = brand.Icon;
  return <span className="assistant-model-glyph" data-brand={brand.key} aria-hidden="true"><BrandIcon stroke={1.8} /></span>;
}

export function AssistantComposer({
  pendingAttachments,
  busy,
  uploadError,
  inputRef,
  input,
  standalone,
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
}) {
  return <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    {pendingAttachments.length && !busy ? <div className="assistant-attachments">{pendingAttachments.slice(-4).map((item) => <span key={item.id}>{item.kind === "image" ? (item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="assistant-attachment-image">▧</span>) : <IconFileText aria-hidden="true" />}<span>{item.name}</span></span>)}</div> : null}
    {uploadError ? <div className="assistant-composer__notice" role="status"><span>{uploadError}</span><button type="button" onClick={onDismissUploadError} aria-label="关闭"><IconX aria-hidden="true" /></button></div> : null}
    <textarea ref={inputRef} value={input} onChange={onInputChange} onKeyDown={onInputKeyDown} placeholder={standalone ? "问任何问题，或直接输入本地项目路径" : "问当前内容"} rows="2" disabled={busy} />
    {permissionOpen ? <div className="assistant-permission-menu" ref={permissionRef} role="menu" aria-label="选择权限">
      {permissionModes.map((item) => <button type="button" role="menuitemradio" key={item.id} aria-checked={item.id === permissionMode} onClick={() => onChoosePermissionMode(item.id)} disabled={busy || modePending}><IconShieldCheck aria-hidden="true" /><span><b>{item.label}</b><small>{item.description}</small></span>{item.id === permissionMode ? <IconCheck aria-hidden="true" /> : null}</button>)}
    </div> : null}
    {menu && menu !== "models" ? <div className="assistant-command-menu" role="menu">
      <header><span>{menu === "models" ? "选择模型" : menu === "experts" ? "选择专家" : "选择 Skill"}{menuQuery ? <em>“{menuQuery}”</em> : null}</span><button type="button" onClick={onCloseMenu}><IconX aria-hidden="true" /></button></header>
      {filteredMenuItems.length ? filteredMenuItems.map((item, index) => <button type="button" role="menuitem" aria-current={index === menuIndex ? "true" : undefined} key={item.id} onMouseEnter={() => onMenuIndex(index)} onClick={() => onChooseMenuItem(item)} disabled={menu === "models" && modelPending}><span className="assistant-command-menu__mark">{menu === "experts" ? "@" : menu === "skills" ? "/" : <ModelGlyph id={item.id} provider={item.provider} />}</span><span><b>{item.label}{menu === "models" && item.id === model ? <em>当前</em> : null}</b><small>{item.hint}</small></span></button>) : <p className="assistant-command-menu__empty">{menu === "models" ? "暂时没有可用模型" : "没有匹配项"}</p>}
    </div> : null}
    <footer>
      <div className="assistant-composer__left">
        <><input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.md,.markdown,.txt,.csv,.json,.xml,.html,.htm,.yaml,.yml,.js,.jsx,.ts,.tsx,.css" onChange={onUploadFile} /><button type="button" className="assistant-composer__attach" title={uploading ? "正在读取附件" : "添加图片或文件"} aria-label={uploading ? "正在读取附件" : "添加图片或文件"} onClick={() => fileRef.current?.click()} disabled={uploading}><IconPlus aria-hidden="true" /></button></>
        <button type="button" className="assistant-composer__access" title="权限" onClick={onTogglePermission} aria-expanded={permissionOpen} disabled={busy || modePending}><IconShieldCheck aria-hidden="true" /><span>权限 {permissionModes.find((item) => item.id === permissionMode)?.label || "日常"}</span><IconChevronDown aria-hidden="true" /></button>
      </div>
      <div className="assistant-composer__right">
        <div className="assistant-model-picker">
          <button type="button" className="assistant-composer__model" title={modelNotice || "从当前接口返回的可用模型中选择"} onClick={onToggleModel} aria-expanded={menu === "models"} disabled={busy || modelPending}><ModelGlyph id={model} provider={models.find((item) => item.id === model)?.ownedBy} /><b>{models.find((item) => item.id === model)?.name || model || "默认模型"}</b><IconChevronDown aria-hidden="true" /></button>
          {menu === "models" ? <div className="assistant-command-menu assistant-command-menu--models" role="menu">
            <header><span>选择模型</span><button type="button" onClick={onCloseMenu}><IconX aria-hidden="true" /></button></header>
            {filteredMenuItems.length ? filteredMenuItems.map((item, index) => <button type="button" role="menuitem" aria-current={index === menuIndex ? "true" : undefined} key={item.id} onMouseEnter={() => onMenuIndex(index)} onClick={() => onChooseMenuItem(item)} disabled={modelPending}><span className="assistant-command-menu__mark"><ModelGlyph id={item.id} provider={item.provider} /></span><span><b>{item.label}{item.id === model ? <em>当前</em> : null}</b><small>{item.hint}</small></span></button>) : <p className="assistant-command-menu__empty">暂时没有可用模型</p>}
          </div> : null}
        </div>
        {busy ? <button type="button" className="assistant-send assistant-send--stop" onClick={onStop} aria-label="停止"><IconX aria-hidden="true" /></button> : <button type="submit" className="assistant-send" disabled={(!input.trim() && !pendingAttachments.length) || loading || uploading} aria-label="发送"><IconSend aria-hidden="true" /></button>}
      </div>
    </footer>
  </form>;
}
