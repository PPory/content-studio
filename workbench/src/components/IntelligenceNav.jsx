import "./intelligence-nav.css";

const destinations = [
  ["intel", "精选"],
  ["intel-topics", "选题"],
  ["intel-resources", "资料"],
  ["intel-channels", "信源管理"],
  ["intel-runs", "处理记录"],
  ["intel-reports", "每周回顾"],
  ["hot", "AI 热点"],
];

/** Shared destinations stay available when reading or managing intelligence. */
export function IntelligenceNav({ current, onGo }) {
  return <nav className="intel-section-nav" aria-label="情报管理">
    {destinations.map(([view, label]) => <a
      key={view}
      href={`#/${view}`}
      aria-current={view === current ? "page" : undefined}
      onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onGo(view);
      }}
    >{label}</a>)}
  </nav>;
}
