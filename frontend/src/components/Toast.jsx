import { useEffect } from 'react';
import { CheckCircle, AlertCircle, XCircle, X } from 'lucide-react';

const CFG = {
  success: { Icon: CheckCircle, color: 'var(--green)' },
  error:   { Icon: XCircle,     color: 'var(--red)'   },
  info:    { Icon: AlertCircle, color: 'var(--cyan)'  },
};

export default function Toast({ message, type = 'info', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4500); return () => clearTimeout(t); }, [onClose]);
  const c = CFG[type] || CFG.info;
  return (
    <div className="toast-enter flex items-center gap-3 font-mono"
      role="status" aria-live="polite"
      style={{
        padding: '11px 14px', borderRadius: 10,
        background: 'var(--bg-surface)',
        border: `1px solid color-mix(in srgb, ${c.color} 28%, var(--border))`,
        borderLeft: `3px solid ${c.color}`,
        boxShadow: 'var(--shadow-lg)', minWidth: 260, fontSize: 12,
      }}>
      <c.Icon size={14} style={{ color: c.color, flexShrink: 0 }} />
      <span style={{ color: 'var(--text-primary)', flex: 1 }}>{message}</span>
      <button onClick={onClose} aria-label="Dismiss notification"
        style={{ color: 'var(--text-muted)', lineHeight: 1, cursor: 'pointer', background: 'none', border: 'none', padding: 2 }}>
        <X size={12} />
      </button>
    </div>
  );
}
