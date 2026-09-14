import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {RowDelete} from './ui.jsx';
export function DirectionBrowser({items,renderDetail,initialKey='',onReadingChange,onRemove,layout='card'}){
 const [selected,setSelected]=useState(null),[visited,setVisited]=useState([]),[confirmKey,setConfirmKey]=useState('');
 const root=useRef(null),gridPositions=useRef(new Map()),readPositions=useRef(new Map()),initialUsed=useRef('');
 const group=items[0]?.group||'empty';
 const open=(item)=>{
  const main=root.current?.closest('.main');
  if(!selected)gridPositions.current.set(group,main?.scrollTop||0);
  if(selected){const pane=root.current?.querySelector('[data-reader-active="true"]');readPositions.current.set(selected,pane?.scrollTop||0);}
  setVisited(old=>old.some(v=>v.key===item.key)?old: [...old,item]);setSelected(item.key);onReadingChange?.(true);
 };
 const back=()=>{const pane=root.current?.querySelector('[data-reader-active="true"]');readPositions.current.set(selected,pane?.scrollTop||0);setSelected(null);onReadingChange?.(false);};
 useEffect(()=>{if(initialKey&&initialUsed.current!==initialKey){const item=items.find(i=>i.key===initialKey);if(item){initialUsed.current=initialKey;open(item);}}},[initialKey,items]);
 useEffect(()=>{if(selected&&!items.some(i=>i.key===selected)){setSelected(null);onReadingChange?.(false);}},[group]);
 useLayoutEffect(()=>{
  const main=root.current?.closest('.main');
  if(selected){if(main)main.scrollTop=0;const pane=root.current?.querySelector('[data-reader-active="true"]');if(pane){pane.scrollTop=readPositions.current.get(selected)||0;pane.focus({preventScroll:true});}}
  else if(main)main.scrollTop=gridPositions.current.get(group)||0;
 },[selected]);
 const current=items.findIndex(i=>i.key===selected);
 return <section ref={root} className={`direction-browser ${selected?'is-reading':''}`} aria-label="方向浏览">
  {/* ⚠️ 整张卡不再是一颗 `<button>`：移除入口要待在卡里，而按钮里套按钮是非法 HTML。
      和 Wiki 列表行、选题卡同一个形状（`ui.jsx` 的 `RowDelete`）。 */}
  {/* 只有**保存过**的方向才能移除：新发现那一档还没落库，「移除」在那儿没有对象。
      文案是「移除方向」不是「移入回收站」——它取消的是你那一次保存，不是把东西丢进回收站。 */}
  {!selected&&layout==='list'&&<div className="rows direction-rows">{items.map(item=><div className="row" key={item.key} data-confirm={confirmKey===item.key?'':undefined}>
   <div className="row-head">
    <button className="row-title direction-row__open" aria-label={item.title} data-direction-key={item.key} onClick={()=>open(item)}>{item.title}</button>
    <span className="row-meta"><span className="direction-row__problem">{item.summary}</span><span className="direction-row__status">{item.status}</span></span>
    {onRemove&&item.saved?<span className="direction-row__acts"><RowDelete onDelete={()=>onRemove(item)} label="移除方向" title={`移除方向：${item.title}`} onOpenChange={open=>setConfirmKey(open?item.key:'')}/></span>:null}
   </div>
  </div>)}</div>}
  {!selected&&layout!=='list'&&<div className="direction-card-grid">{items.map(item=><article className="direction-overview-card" key={item.key} data-confirm={confirmKey===item.key?'':undefined}>
   <button className="direction-overview-card__open" aria-label={item.title} data-direction-key={item.key} onClick={()=>open(item)}><span className="direction-card-status">{item.status}</span><strong>{item.title}</strong><p>{item.summary}</p><p className="direction-card-reason">{item.reason}</p></button>
   {onRemove&&item.saved?<span className="direction-overview-card__acts"><RowDelete onDelete={()=>onRemove(item)} label="移除方向" title={`移除方向：${item.title}`} onOpenChange={open=>setConfirmKey(open?item.key:'')}/></span>:null}
  </article>)}</div>}
  {selected&&<header className="direction-reader-toolbar"><button className="btn" onClick={()=>{const key=selected;back();requestAnimationFrame(()=>root.current?.querySelector(`[data-direction-key="${CSS.escape(key)}"]`)?.focus({preventScroll:true}));}}>← 返回卡片总览</button><span>{current+1} / {items.length}</span><div className="direction-reader-paging"><button className="btn" disabled={current<=0} onClick={()=>open(items[current-1])}>上一条</button><button className="btn" disabled={current<0||current>=items.length-1} onClick={()=>open(items[current+1])}>下一条</button></div></header>}
  <div className="direction-reader-layout" hidden={!selected}>
   <nav className="direction-reader-list" aria-label="切换方向">{items.map(item=><button key={item.key} aria-current={selected===item.key?'page':undefined} onClick={()=>open(item)}><strong>{item.title}</strong><p>{item.summary}</p><small>{item.status}</small></button>)}</nav>
   <div className="direction-reader-panes">{visited.map(cached=>{const item=items.find(i=>i.key===cached.key)||cached;return <div key={item.key} className="direction-reader" tabIndex={-1} hidden={selected!==item.key} data-reader-active={selected===item.key}>{renderDetail(item)}</div>;})}</div>
  </div>
 </section>;
}
