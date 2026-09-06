import { LibraryBrowser } from "../components/LibraryBrowser.jsx";
import "./workspace-home.css";
export function Library({ onGo, onQuickNote, onImport, initialItem }) {
 return <section className="workspace-library"><header className="overview-heading"><div><small>阅读与连接</small><h1>阅读与 Wiki</h1><p>读原文，留下理解；遇到新问题时，让知识重新连接。</p></div><div className="row-actions"><button className="btn" onClick={onImport}>导入资料</button><button className="btn" onClick={onQuickNote}>记下灵感</button></div></header><LibraryBrowser onGo={onGo} initialItem={initialItem} /><nav className="library-browse-links" aria-label="分类浏览">{[["entries","Wiki 知识库"],["shelf","书籍"],["sources","来源"],["materials","素材"],["ideas","灵感记录"]].map(([view,label]) => <button key={view} className="btn btn-sm" onClick={() => onGo(view)}>{label}</button>)}</nav></section>;
}
