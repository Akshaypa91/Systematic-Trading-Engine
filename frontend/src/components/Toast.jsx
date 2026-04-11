import { useEffect } from 'react';
import { CheckCircle, AlertCircle, XCircle, X } from 'lucide-react';

const CFG = {
  success: { Icon: CheckCircle, color:'var(--green)',  border:'rgba(0,229,160,0.25)'  },
  error:   { Icon: XCircle,     color:'var(--red)',    border:'rgba(255,77,106,0.25)' },
  info:    { Icon: AlertCircle, color:'var(--cyan)',   border:'rgba(0,212,255,0.25)'  },
};

export default function Toast({ message, type = 'info', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4500); return () => clearTimeout(t); }, [onClose]);
  const c = CFG[type] || CFG.info;
  return (
    <div className="toast-enter flex items-center gap-3 font-mono"
      style={{ padding:'11px 16px', borderRadius:10, background:'var(--bg-elevated)', border:`1px solid ${c.border}`,
        boxShadow:'0 8px 32px rgba(0,0,0,0.4)', minWidth:260, fontSize:12 }}>
      <c.Icon size={14} style={{ color:c.color, flexShrink:0 }} />
      <span style={{ color:'var(--text-primary)', flex:1 }}>{message}</span>
      <button onClick={onClose} style={{ color:'var(--text-muted)', lineHeight:1, cursor:'pointer', background:'none', border:'none', padding:0 }}>
        <X size={12} />
      </button>
    </div>
  );
}
