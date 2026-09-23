import { useEffect, useId, useRef, useState } from "react";

export function AnchoredPopover({
  label,
  trigger,
  className = "",
  panelClassName = "",
  panelRole = "dialog",
  align = "end",
  children,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const close = ({ restoreFocus = false } = {}) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className={`anchored-popover ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="anchored-popover__trigger"
        ref={triggerRef}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup={panelRole === "menu" ? "menu" : "dialog"}
        onClick={() => setOpen(value => !value)}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={panelId}
          className={`anchored-popover__panel is-${align} ${panelClassName}`.trim()}
          role={panelRole}
          aria-label={label}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
