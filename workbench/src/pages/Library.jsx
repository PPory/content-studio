import { LibraryBrowser } from "../components/LibraryBrowser.jsx";
export function Library({ onGo, onQuickNote, onImport }) {
 return <section className="task-page"><header className="task-page-head"><div><h1>资料库</h1><p>原文、经历与自己的理解，都能找回来。</p></div><div className="row-actions"><button className="btn" onClick={onImport}>导入资料</button><button className="btn btn-primary" onClick={onQuickNote}>记一下</button></div></header><LibraryBrowser onGo={onGo} /><details className="library-more"><summary>按原有方式浏览</summary><div className="row-actions">{[["materials","素材"],["entries","知识笔记"],["sources","来源"],["shelf","书籍"],["ideas","灵感记录"],["seeds","想法记录"]].map(([view,label]) => <button key={view} className="btn btn-sm" onClick={() => onGo(view)}>{label}</button>)}</div></details></section>;
}
