import { AnchoredPopover } from "./AnchoredPopover.jsx";
import "./intelligence-nav.css";
const destinations=[["intel-resources","原始资料"],["intel-channels","信源设置"],["intel-runs","处理详情"],["intel-reports","每周回顾"],["hot","AIhot 原始信息流"]];
/** Secondary tools never form a competing reading or topic workflow. */
export function IntelligenceNav({current,onGo}) {
  return <nav className="intel-section-nav" aria-label="情报工具">{current!=="intel"&&<a href="#/intel" onClick={event=>{if(event.button||event.ctrlKey||event.metaKey)return;event.preventDefault();onGo("intel");}}>← 返回情报</a>}<AnchoredPopover className="intel-nav-more" panelClassName="intel-nav-menu" label="情报工具" trigger="···" panelRole="menu">{close=>destinations.map(([view,label])=><a role="menuitem" key={view} href={`#/${view}`} aria-current={view===current?"page":undefined} onClick={()=>close()}>{label}</a>)}</AnchoredPopover></nav>;
}
