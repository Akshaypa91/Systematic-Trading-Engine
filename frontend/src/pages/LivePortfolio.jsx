// src/pages/LivePortfolio.jsx — Phase 3
// Live positions (with exit), funds, holdings/allocation, and the risk +
// emergency controls. Read-only sync from Upstox via /api/live/*.
import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import Toast from '../components/Toast';
import RiskEmergencyPanel from '../components/RiskEmergencyPanel';
import { liveAPI } from '../services/api';
import { useTradingMode } from '../context/TradingModeContext';
import { Wallet, TrendingUp, Layers, RefreshCw, LogOut, ShieldOff, Loader2, Clock, PieChart, Info } from 'lucide-react';

const num    = (v) => (isFinite(Number(v)) ? Number(v) : 0);
const money  = (v, d = 2) => v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: d })}`;
const signed = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pnlColor  = (v) => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-secondary)';
// Funds can legitimately be negative (settlement debit) — color by sign so a
// negative cash balance never shows green.
const fundColor = (v) => v == null ? 'var(--text-primary)' : v < 0 ? 'var(--red)' : v > 0 ? 'var(--green)' : 'var(--text-secondary)';
const sum = (arr, key) => (Array.isArray(arr) ? arr.reduce((a, p) => a + num(p[key]), 0) : 0);

function Stat({ label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

// Prominent summary tile for the top-of-page metrics strip.
function SummaryTile({ label, value, sub, color, Icon }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 150, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {Icon && <Icon size={12} style={{ color: color || 'var(--text-muted)' }} />}
        <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 21, fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{sub}</div>}
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
  const [syncedAt,  setSyncedAt]  = useState(null);
  const onToast = (msg, type = 'info') => setToast({ msg, type });

  const load = useCallback(async () => {
    const [p, f, h] = await Promise.allSettled([liveAPI.positions(), liveAPI.fundsNormalized(), liveAPI.holdings()]);
    if (p.status === 'fulfilled') setPositions(Array.isArray(p.value.data?.data) ? p.value.data.data : []);
    if (f.status === 'fulfilled') setFunds(f.value.data?.data || null);
    if (h.status === 'fulfilled') setHoldings(h.value.data || null);
    setSyncedAt(new Date());
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

  // Derived roll-ups for the summary strip.
  const dayPnl      = sum(positions, 'dayPnl');
  const overallPnl  = sum(positions, 'overallPnl');
  const cash        = funds ? num(funds.availableCash) : null;
  const holdingsVal = hs ? num(hs.currentValue) : 0;
  const netWorth    = funds || hs ? num(cash) + holdingsVal : null;   // available cash + holdings value
  const cashLow     = cash != null && cash <= 0;

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ maxWidth: 1280 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Wallet size={18} style={{ color: 'var(--green)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Live Portfolio</h1>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              {syncedAt && (
                <span className="font-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text-muted)' }}>
                  <Clock size={10} /> Synced {syncedAt.toLocaleTimeString('en-IN', { hour12: false })}
                </span>
              )}
              <button onClick={load} className="ws-pill" style={{ cursor: 'pointer' }}>
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Positions · Funds · Holdings — synced from Upstox, 5s refresh</p>

          {/* Summary strip */}
          {brokerLinked && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <SummaryTile label="Net Worth" Icon={Wallet} color="var(--cyan)"
                value={netWorth == null ? '—' : money(netWorth, 0)}
                sub="Cash + holdings" />
              <SummaryTile label="Available Cash" Icon={Wallet} color={fundColor(cash)}
                value={money(cash, 0)} sub={cashLow ? 'Add funds to trade' : 'Free margin'} />
              <SummaryTile label="Day P&L" Icon={TrendingUp} color={pnlColor(dayPnl)}
                value={positions.length ? signed(dayPnl) : '—'} sub="Open positions" />
              <SummaryTile label="Overall P&L" Icon={TrendingUp} color={pnlColor(overallPnl)}
                value={positions.length ? signed(overallPnl) : '—'} sub={`${positions.length} position${positions.length === 1 ? '' : 's'}`} />
            </div>
          )}

          {!brokerLinked && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, var(--amber) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 24%, transparent)' }}>
              <ShieldOff size={15} style={{ color: 'var(--amber)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Broker not connected — connect Upstox to sync live positions, funds and holdings.</span>
            </div>
          )}

          <div className="lp-grid">
            {/* LEFT: funds + positions + holdings */}
            <div className="lp-left" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {/* Funds */}
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, fontFamily: 'var(--font-mono)' }}>Funds</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  <Stat label="Available Cash" value={money(funds?.availableCash)} color={fundColor(funds?.availableCash)} />
                  <Stat label="Used Margin" value={money(funds?.usedMargin)} color="var(--amber)" />
                  <Stat label="Collateral" value={money(funds?.collateral)} />
                  <Stat label="Buying Power" value={money(funds?.buyingPower)} color={fundColor(funds?.buyingPower)} />
                  <Stat label="Opening Balance" value={money(funds?.openingBalance)} color={fundColor(funds?.openingBalance)} />
                </div>
                {cashLow && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14, padding: '9px 12px', borderRadius: 8, background: 'color-mix(in srgb, var(--amber) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 22%, transparent)' }}>
                    <Info size={13} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                      Available cash is {cash < 0 ? 'negative' : 'zero'}. A negative balance is usually a small settlement debit; either way you'll need to add funds in Upstox before a live BUY can clear. Funds also lock nightly (~12am–5:30am IST) during Upstox settlement.
                    </span>
                  </div>
                )}
              </div>

              {/* Positions */}
              <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)' }}>
                  <TrendingUp size={14} style={{ color: 'var(--cyan)' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Positions</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{positions.length}</span>
                </div>
                {positions.length === 0 ? (
                  <div style={{ padding: '36px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                    {loading ? <Loader2 size={18} className="animate-spin" /> : <TrendingUp size={20} style={{ opacity: 0.35 }} />}
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{loading ? 'Loading positions…' : 'No open positions'}</span>
                    {!loading && <span className="font-mono" style={{ fontSize: 10.5 }}>Intraday & delivery positions from Upstox appear here.</span>}
                  </div>
                ) : (
                  <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
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
                {hs?.holdings?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {hs.holdings.map(h => {
                      const alloc = holdingsVal > 0 ? (num(h.currentValue ?? (num(h.qty) * num(h.lastPrice ?? h.avgPrice))) / holdingsVal) * 100 : 0;
                      return (
                        <div key={h.symbol} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, fontFamily: 'var(--font-mono)', padding: '6px 0', borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)', minWidth: 92 }}>{h.symbol}</span>
                          <span style={{ color: 'var(--text-muted)', flex: 1 }}>{h.qty} @ {money(h.avgPrice)}</span>
                          {alloc > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{alloc.toFixed(0)}%</span>}
                          <span style={{ color: pnlColor(h.totalGain), minWidth: 80, textAlign: 'right' }}>{signed(h.totalGain)}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 2px', color: 'var(--text-muted)' }}>
                    <PieChart size={14} style={{ opacity: 0.5 }} />
                    <span className="font-mono" style={{ fontSize: 11 }}>{loading ? 'Loading holdings…' : 'No delivery holdings in your demat.'}</span>
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
