// src/pages/LivePortfolio.jsx — Phase 3
// Live positions (with exit), funds, holdings/allocation, and the risk +
// emergency controls. Read-only sync from Upstox via /api/live/*.
import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import Toast from '../components/Toast';
import RiskEmergencyPanel from '../components/RiskEmergencyPanel';
import { liveAPI } from '../services/api';
import { useTradingMode } from '../context/TradingModeContext';
import { Wallet, TrendingUp, Layers, RefreshCw, LogOut, ShieldOff, Loader2 } from 'lucide-react';

const money  = (v, d = 2) => v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: d })}`;
const signed = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pnlColor = (v) => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-secondary)';

function Stat({ label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

export default function LivePortfolio() {
  const { brokerLinked } = useTradingMode();
  const [positions, setPositions] = useState([]);
  const [funds,     setFunds]     = useState(null);
  const [holdings,  setHoldings]  = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [exiting,   setExiting]   = useState(null);
  const [toast,     setToast]     = useState(null);
  const onToast = (msg, type = 'info') => setToast({ msg, type });

  const load = useCallback(async () => {
    const [p, f, h] = await Promise.allSettled([liveAPI.positions(), liveAPI.fundsNormalized(), liveAPI.holdings()]);
    if (p.status === 'fulfilled') setPositions(Array.isArray(p.value.data?.data) ? p.value.data.data : []);
    if (f.status === 'fulfilled') setFunds(f.value.data?.data || null);
    if (h.status === 'fulfilled') setHoldings(h.value.data || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function exit(symbol) {
    setExiting(symbol);
    try { await liveAPI.exitPosition(symbol); onToast(`Exit order sent for ${symbol}`, 'success'); load(); }
    catch (e) { onToast(e.response?.data?.error || 'Exit failed', 'error'); }
    finally { setExiting(null); }
  }

  const hs = holdings?.summary;

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ maxWidth: 1280 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Wallet size={18} style={{ color: 'var(--green)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Live Portfolio</h1>
            <button onClick={load} className="ws-pill" style={{ marginLeft: 'auto', cursor: 'pointer' }}>
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Positions · Funds · Holdings — synced from Upstox, 5s refresh</p>

          {!brokerLinked && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, var(--amber) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 24%, transparent)' }}>
              <ShieldOff size={15} style={{ color: 'var(--amber)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Broker not connected — connect Upstox to sync live positions, funds and holdings.</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(280px,1fr)', gap: 16, alignItems: 'start' }}>
            {/* LEFT: funds + positions + holdings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Funds */}
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, fontFamily: 'var(--font-mono)' }}>Funds</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  <Stat label="Available Cash" value={money(funds?.availableCash)} color="var(--green)" />
                  <Stat label="Used Margin" value={money(funds?.usedMargin)} color="var(--amber)" />
                  <Stat label="Collateral" value={money(funds?.collateral)} />
                  <Stat label="Buying Power" value={money(funds?.buyingPower)} color="var(--cyan)" />
                  <Stat label="Opening Balance" value={money(funds?.openingBalance)} />
                </div>
              </div>

              {/* Positions */}
              <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)' }}>
                  <TrendingUp size={14} style={{ color: 'var(--cyan)' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Positions</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{positions.length}</span>
                </div>
                {positions.length === 0 ? (
                  <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{loading ? 'Loading…' : 'No open positions'}</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                        {['Symbol', 'Qty', 'Avg', 'LTP', "Day P&L", 'Overall P&L', 'MTM', ''].map(h => (
                          <th key={h} style={{ padding: '9px 12px', fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map(p => (
                        <tr key={p.symbol} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>{p.symbol}</td>
                          <td style={{ padding: '9px 12px' }}>{p.qty}</td>
                          <td style={{ padding: '9px 12px' }}>{money(p.avgPrice)}</td>
                          <td style={{ padding: '9px 12px' }}>{money(p.ltp)}</td>
                          <td style={{ padding: '9px 12px', color: pnlColor(p.dayPnl) }}>{signed(p.dayPnl)}</td>
                          <td style={{ padding: '9px 12px', color: pnlColor(p.overallPnl) }}>{signed(p.overallPnl)}</td>
                          <td style={{ padding: '9px 12px', color: pnlColor(p.mtm) }}>{signed(p.mtm)}</td>
                          <td style={{ padding: '9px 12px' }}>
                            {p.qty !== 0 && (
                              <button onClick={() => exit(p.symbol)} disabled={exiting === p.symbol}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, background: 'color-mix(in srgb, var(--red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)', color: 'var(--red)' }}>
                                {exiting === p.symbol ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />} Exit
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Holdings */}
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Layers size={14} style={{ color: 'var(--purple, var(--cyan))' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Holdings</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: hs?.holdings?.length ? 14 : 0 }}>
                  <Stat label="Invested" value={money(hs?.invested)} />
                  <Stat label="Current Value" value={money(hs?.currentValue)} />
                  <Stat label="Today's Gain" value={signed(hs?.todayGain)} color={pnlColor(hs?.todayGain)} />
                  <Stat label="Total Gain" value={signed(hs?.totalGain)} color={pnlColor(hs?.totalGain)} />
                </div>
                {hs?.holdings?.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {hs.holdings.map(h => (
                      <div key={h.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, fontFamily: 'var(--font-mono)', padding: '5px 0', borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{h.symbol}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{h.qty} @ {money(h.avgPrice)}</span>
                        <span style={{ color: pnlColor(h.totalGain) }}>{signed(h.totalGain)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: risk + emergency */}
            <RiskEmergencyPanel onToast={onToast} />
          </div>
        </div>
      </main>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 50 }}>
          <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </AppShell>
  );
}
