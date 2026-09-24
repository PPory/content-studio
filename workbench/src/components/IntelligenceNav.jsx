import { AnchoredPopover } from "./AnchoredPopover.jsx";
import { IconDots } from "./icons.jsx";
import "./intelligence-nav.css";
// 只留真正有用的两个去处（2026-09-24）：信源设置里新增的信源进不了热点，每周回顾基于旧流程，
// AIhot 原始信息流和「原始资料」按 AIhot 筛选重复——这三个从菜单去掉，页面暂留，直接访问地址仍能打开。
const destinations=[["intel-resources","原始资料"],["intel-runs","处理详情"]];
/** Secondary tools never form a competing reading or topic workflow. */
/** `extra`：当前页面自己的菜单项（如自动更新开关），排在跳转项之后。 */
export function IntelligenceNav({current,onGo,extra}) {
  return <nav className="intel-section-nav" aria-label="情报工具">{current!=="intel"&&<a href="#/intel" onClick={event=>{if(event.button||event.ctrlKey||event.metaKey)return;event.preventDefault();onGo("intel");}}>← 返回情报</a>}<AnchoredPopover className="intel-nav-more" panelClassName="intel-nav-menu intel-menu" label="情报工具" trigger={<IconDots aria-hidden="true" stroke={1.8}/>} panelRole="menu">{close=><>{destinations.map(([view,label])=><a role="menuitem" key={view} href={`#/${view}`} aria-current={view===current?"page":undefined} onClick={()=>close()}>{label}</a>)}{extra?.(close)}</>}</AnchoredPopover></nav>;
}
