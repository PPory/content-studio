import "./intelligence-workspace.css";

// Intelligence's image-led layout is local to its content pane; the app sidebar is unchanged.
export function IntelligenceHeader({ title, count, desc, aside, action, chips }) {
  return <>
    <header className="intel-page-heading">
      <div><h1>{title}{count ? <span className="intel-page-count">{count}</span> : null}</h1>{desc && <p>{desc}</p>}</div>
      {(aside || action) && <div className="intel-page-actions">{aside || action}</div>}
    </header>
    {chips && <div className="intel-page-filters">{chips}</div>}
  </>;
}
