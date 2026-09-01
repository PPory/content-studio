import { useEffect, useRef, useState } from "react";
import { IconArrowUp } from "./icons.jsx";

export function ScrollToTop({ label = "返回顶部" }) {
  const anchorRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scroller = anchorRef.current?.closest(".main");
    if (!scroller) return undefined;
    const update = () => {
      const scrollable = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const threshold = Math.min(420, Math.max(120, scrollable * 0.45));
      setVisible(scrollable > 120 && scroller.scrollTop > threshold);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, []);

  return (
    <span ref={anchorRef} className="page-to-top-anchor">
      {visible ? (
        <button type="button" className="page-to-top" aria-label={label} title={label}
          onClick={() => anchorRef.current?.closest(".main")?.scrollTo({ top: 0, behavior: "smooth" })}>
          <IconArrowUp aria-hidden="true" stroke={1.9} />
        </button>
      ) : null}
    </span>
  );
}
