import {useEffect,useLayoutEffect,useRef,useState} from 'react';
export function DirectionBrowser({items,renderDetail,initialKey='',onReadingChange}){
 const [selected,setSelected]=useState(null),[visited,setVisited]=useState([]);
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
  {!selected&&<div className="direction-card-grid">{items.map(item=><button className="direction-overview-card" aria-label={item.title} data-direction-key={item.key} key={item.key} onClick={()=>open(item)}><span className="direction-card-status">{item.status}</span><strong>{item.title}</strong><p>{item.summary}</p><p className="direction-card-reason">{item.reason}</p></button>)}</div>}
  {selected&&<header className="direction-reader-toolbar"><button className="btn" onClick={()=>{const key=selected;back();requestAnimationFrame(()=>root.current?.querySelector(`[data-direction-key="${CSS.escape(key)}"]`)?.focus({preventScroll:true}));}}>← 返回卡片总览</button><span>{current+1} / {items.length}</span><div className="direction-reader-paging"><button className="btn" disabled={current<=0} onClick={()=>open(items[current-1])}>上一条</button><button className="btn" disabled={current<0||current>=items.length-1} onClick={()=>open(items[current+1])}>下一条</button></div></header>}
  <div className="direction-reader-layout" hidden={!selected}>
   <nav className="direction-reader-list" aria-label="切换方向">{items.map(item=><button key={item.key} aria-current={selected===item.key?'page':undefined} onClick={()=>open(item)}><strong>{item.title}</strong><p>{item.summary}</p><small>{item.status}</small></button>)}</nav>
   <div className="direction-reader-panes">{visited.map(cached=>{const item=items.find(i=>i.key===cached.key)||cached;return <div key={item.key} className="direction-reader" tabIndex={-1} hidden={selected!==item.key} data-reader-active={selected===item.key}>{renderDetail(item)}</div>;})}</div>
  </div>
 </section>;
}
