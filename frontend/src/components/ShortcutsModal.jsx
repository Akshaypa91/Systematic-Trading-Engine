// src/components/ShortcutsModal.jsx
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { SHORTCUT_ROUTES } from '../hooks/useGlobalShortcuts';

export default function ShortcutsModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="shortcuts-modal-backdrop" onClick={onClose}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Keyboard Shortcuts</div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: 6 }} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {SHORTCUT_ROUTES.map(s => (
          <div key={s.keys} className="shortcuts-row">
            <span>{s.label}</span>
            <span style={{ display: 'flex', gap: 4 }}>
              {s.keys.split(' ').map((k, i) => <span key={i} className="kbd">{k.toUpperCase()}</span>)}
            </span>
          </div>
        ))}
        <div className="shortcuts-row">
          <span>Show this dialog</span>
          <span className="kbd">?</span>
        </div>
      </div>
    </div>
  );
}
