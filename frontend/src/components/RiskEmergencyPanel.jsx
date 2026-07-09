// src/components/RiskEmergencyPanel.jsx — Phase 3
// Kill switch + configurable risk limits + emergency actions (stop / exit-all /
// cancel-all). Destructive actions require an explicit typed confirmation.
import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, Power, Ban, LogOut, Save, Loader2, AlertTriangle } from 'lucide-react';
import { liveAPI } from '../services/api';

const LIMIT_FIELDS = [
  { key: 'dailyLossLimit',  label: 'Daily Loss Limit (₹)' },
  { key: 'maxExposure',     label: 'Max Exposure (₹)' },
  { key: 'maxPositionSize', label: 'Max Position Size (₹)' },
  { key: 'maxOrdersPerDay', label: 'Max Orders / Day' },
];

function Confirm({ title, body, confirmLabel, danger, onConfirm, onCancel, busy }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ maxWidth: 380, padding: 22, margin: 16, border: `1px solid color-mix(in srgb, var(--red) 40%, transparent)` }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <AlertTriangle size={18} style={{ color: 'var(--red)' }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 18 }}>{body}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} className="flex-1 py-2 rounded-lg text-sm font-semibold" style={{ flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '9px 0', borderRadius: 8 }}>Cancel</button>
          <button onClick={onConfirm} disabled={busy} style={{ flex: 1, background: `color-mix(in srgb, ${danger ? 'var(--red)' : 'var(--green)'} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${danger ? 'var(--red)' : 'var(--green)'} 45%, transparent)`, color: danger ? 'var(--red)' : 'var(--green)', padding: '9px 0', borderRadius: 8, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RiskEmergencyPanel({ onToast }) {
  const [kill,   setKill]     = useState(false);
  const [draft,  setDraft]    = useState({});
  const [saving, setSaving]   = useState(false);
  const [confirm, setConfirm] = useState(null);   // { kind }
  const [busy,   setBusy]     = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await liveAPI.risk();
      setDraft(res.data?.limits || {});
      setKill(!!res.data?.killSwitch);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveLimits() {
    setSaving(true);
    try { await liveAPI.setRisk(draft); onToast?.('Risk limits saved', 'success'); load(); }
    catch (e) { onToast?.(e.response?.data?.error || 'Save failed', 'error'); }
    finally { setSaving(false); }
  }

  async function toggleKill() {
    const next = !kill;
    setKill(next);
    try { await liveAPI.killSwitch(next); onToast?.(next ? 'Kill switch ENGAGED — live trading blocked' : 'Kill switch released', next ? 'error' : 'success'); }
    catch (e) { setKill(!next); onToast?.(e.response?.data?.error || 'Failed', 'error'); }
  }

  async function runEmergency(kind) {
    setBusy(true);
    try {
      if (kind === 'stop')       { await liveAPI.emergencyStop();   onToast?.('EMERGENCY STOP executed', 'error'); }
      if (kind === 'square-off') { const r = await liveAPI.squareOffAll();    onToast?.(`Squared off ${r.data?.squaredOff ?? 0} position(s)`, 'success'); }
      if (kind === 'cancel-all') { const r = await liveAPI.cancelAllOrders(); onToast?.(`Cancelled ${r.data?.cancelled ?? 0} order(s)`, 'success'); }
      load();
    } catch (e) { onToast?.(e.response?.data?.error || 'Action failed', 'error'); }
    finally { setBusy(false); setConfirm(null); }
  }

  const CONFIRMS = {
    'stop':       { title: 'Emergency Stop', body: 'This engages the kill switch, cancels all open orders, squares off all positions, and forces PAPER mode. Continue?', confirmLabel: 'STOP EVERYTHING' },
    'square-off': { title: 'Square Off All', body: 'Market-exit every open position immediately. This cannot be undone.', confirmLabel: 'Square Off All' },
    'cancel-all': { title: 'Cancel All Orders', body: 'Cancel every open/pending order at the broker.', confirmLabel: 'Cancel All' },
  };

  return (
    <div className="card" style={{ padding: 16, border: '1px solid color-mix(in srgb, var(--red) 22%, transparent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <ShieldAlert size={15} style={{ color: 'var(--red)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Risk &amp; Emergency</span>
      </div>

      {/* Kill switch */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 9, marginBottom: 14, background: kill ? 'color-mix(in srgb, var(--red) 10%, transparent)' : 'var(--bg-elevated)', border: `1px solid ${kill ? 'color-mix(in srgb, var(--red) 40%, transparent)' : 'var(--border)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Power size={14} style={{ color: kill ? 'var(--red)' : 'var(--text-muted)' }} />
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: kill ? 'var(--red)' : 'var(--text-primary)' }}>Kill Switch</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{kill ? 'ENGAGED — live orders blocked' : 'Live trading allowed'}</div>
          </div>
        </div>
        <button onClick={toggleKill} style={{ padding: '6px 14px', borderRadius: 99, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: kill ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'color-mix(in srgb, var(--red) 14%, transparent)', border: `1px solid ${kill ? 'color-mix(in srgb, var(--green) 40%, transparent)' : 'color-mix(in srgb, var(--red) 40%, transparent)'}`, color: kill ? 'var(--green)' : 'var(--red)' }}>
          {kill ? 'Release' : 'Engage'}
        </button>
      </div>

      {/* Risk limits */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        {LIMIT_FIELDS.map(f => (
          <div key={f.key}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>{f.label}</div>
            <input type="number" value={draft[f.key] ?? ''} onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
              style={{ width: '100%', padding: '7px 9px', borderRadius: 7, fontSize: 12.5, fontFamily: 'var(--font-mono)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </div>
        ))}
      </div>
      <button onClick={saveLimits} disabled={saving} style={{ width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'color-mix(in srgb, var(--cyan) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--cyan) 34%, transparent)', color: 'var(--cyan)', marginBottom: 14 }}>
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Limits
      </button>

      {/* Emergency actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button onClick={() => setConfirm('square-off')} style={emBtn('var(--amber)')}><LogOut size={12} /> Exit All</button>
        <button onClick={() => setConfirm('cancel-all')} style={emBtn('var(--amber)')}><Ban size={12} /> Cancel All</button>
        <button onClick={() => setConfirm('stop')} style={{ ...emBtn('var(--red)'), gridColumn: '1 / -1' }}><Power size={13} /> EMERGENCY STOP</button>
      </div>

      {confirm && (
        <Confirm {...CONFIRMS[confirm]} danger busy={busy}
          onCancel={() => setConfirm(null)} onConfirm={() => runEmergency(confirm)} />
      )}
    </div>
  );
}

const emBtn = (c) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '9px 0', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
  background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 36%, transparent)`, color: c,
});
