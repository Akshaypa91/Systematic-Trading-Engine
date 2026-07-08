import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Modal — accessible dialog primitive.
 * Escape closes, backdrop click closes, focus moves into the dialog on open,
 * body scroll locks while open. Purely presentational — callers own state.
 */
export default function Modal({ open, onClose, title, sub, width = 440, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    ref.current?.focus();
    document.body.style.overflow = 'hidden';
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={{ width }}
        tabIndex={-1}
        ref={ref}
      >
        {(title || onClose) && (
          <div className="ui-between" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
            <div>
              {title && <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>}
              {sub && <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                aria-label="Close dialog"
                className="nb-icon-btn"
                style={{ marginLeft: 12 }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {children}
        {footer && <div className="ui-hstack" style={{ gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}
