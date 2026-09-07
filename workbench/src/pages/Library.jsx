import { LibraryBrowser } from "../components/LibraryBrowser.jsx";
import "./workspace-home.css";
export function Library({ onGo, onQuickNote, onImport, initialItem }) {
 return <section className="workspace-library"><header className="overview-heading"><div><h1>阅读与 Wiki</h1><p>查找资料，阅读原文，连接已有的理解。</p></div><div className="row-actions"><button className="btn" onClick={onImport}>导入资料</button><button className="btn" onClick={onQuickNote}>记下灵感</button></div></header><nav className="library-browse-links" aria-label="分类浏览">{[["entries","Wiki 知识库"],["shelf","书籍"],["sources","来源"],["materials","素材"],["ideas","灵感记录"]].map(([view,label]) => <button key={view} className="btn btn-sm" onClick={() => onGo(view)}>{label}</button>)}</nav><LibraryBrowser onGo={onGo} initialItem={initialItem} /></section>;
}
