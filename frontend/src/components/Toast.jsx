import { useEffect } from 'react';
import { CheckCircle, AlertCircle, XCircle, X } from 'lucide-react';

export default function Toast({ message, type = 'info', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const cfg = {
    success: { icon: CheckCircle, color: 'var(--accent-green)', bg: 'rgba(0,230,118,0.08)', border: 'rgba(0,230,118,0.2)' },
    error:   { icon: XCircle,     color: 'var(--accent-red)',   bg: 'rgba(255,71,87,0.08)', border: 'rgba(255,71,87,0.2)' },
    info:    { icon: AlertCircle, color: 'var(--accent-cyan)',  bg: 'rgba(0,212,255,0.08)', border: 'rgba(0,212,255,0.2)' },
  };
  const c = cfg[type] || cfg.info;
  const Icon = c.icon;

  return (
    <div className="toast-slide flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl text-sm font-mono"
      style={{ background: 'var(--bg-elevated)', border: `1px solid ${c.border}`, minWidth: 260 }}>
      <Icon size={15} style={{ color: c.color, flexShrink: 0 }} />
      <span style={{ color: 'var(--text-primary)', flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>
        <X size={13} />
      </button>
    </div>
  );
}
