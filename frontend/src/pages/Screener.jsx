import { useState, useEffect } from 'react';
import AppShell from '../components/AppShell';
import { screenerAPI, signalAPI } from '../services/api';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import {
  Search, RefreshCw, TrendingUp, TrendingDown, Minus,
  ArrowUpDown, SlidersHorizontal, X, Play, Zap, ChevronRight
} from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

const FILTERS = ['ALL', 'BUY_CANDIDATES', 'SELL_CANDIDATES', 'NEUTRAL'];

function ScoreBadge({ score }) {
  const pct   = (Number(score || 0) * 100).toFixed(1);
  const color = score > 0.6 ? 'var(--green)' : score > 0.4 ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono w-10" style={{ color }}>{pct}%</span>
    </div>
  );
}

function SignalChip({ signal, size = 'sm' }) {
  const map = {
    BUY:  { bg: 'color-mix(in srgb, var(--green) 12%, transparent)', border: 'color-mix(in srgb, var(--green) 30%, transparent)',  color: 'var(--green)', icon: TrendingUp },
    SELL: { bg: 'color-mix(in srgb, var(--red) 12%, transparent)',  border: 'color-mix(in srgb, var(--red) 30%, transparent)',  color: 'var(--red)',   icon: TrendingDown },
    HOLD: { bg: 'color-mix(in srgb, var(--amber) 12%, transparent)', border: 'color-mix(in srgb, var(--amber) 30%, transparent)', color: 'var(--amber)', icon: Minus },
  };
  const c = map[signal] || map.HOLD;
  const Icon = c.icon;
  const pad = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1 rounded font-mono font-semibold ${pad}`}
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      <Icon size={size === 'lg' ? 13 : 10} />{signal}
    </span>
  );
}

function MiniSparkline({ data }) {
  if (!data?.length) return (
    <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>No history yet</span>
    </div>
  );
  const min = Math.min(...data), max = Math.max(...data);
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? 'var(--green)' : 'var(--red)';
  return (
    <div style={{ width: '100%', height: 50 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={[min * 0.99, max * 1.01]} hide />
          <Tooltip formatter={v => [`₹${Number(v).toFixed(2)}`, '']}
            contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 10, fontFamily: 'var(--font-mono)' }} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill="url(#spkGrad)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatBlock({ label, value, color }) {
  return (
    <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-mono mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-sm font-bold font-mono" style={{ color: color || 'var(--text-primary)' }}>{value ?? '—'}</div>
    </div>
  );
}

function DetailPanel({ row, onClose, onBacktest }) {
  const [signal,  setSignal]  = useState(null);
  const [sigLoad, setSigLoad] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!row) return;
    setSignal(null); setHistory([]);
    setSigLoad(true);
    signalAPI.get(row.symbol)
      .then(r => setSignal(r.data))
      .catch(() => {})
      .finally(() => setSigLoad(false));
    signalAPI.history(row.symbol, 30)
      .then(r => {
        const prices = (r.data.data || []).map(s => s.price_at_signal).filter(Boolean).reverse();
        setHistory(prices);
      }).catch(() => {});
  }, [row?.symbol]);

  if (!row) return null;
  const score      = row.compositeScore ?? 0;
  const scoreColor = score > 0.6 ? 'var(--green)' : score > 0.4 ? 'var(--amber)' : 'var(--red)';

  return (
    <>
    <button className="scr-backdrop" onClick={onClose} aria-label="Close details" tabIndex={-1} />
    <div className="scr-panel" role="dialog" aria-label={`${row.symbol} details`}>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{row.symbol}</div>
          <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>NSE · Equity</div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          {sigLoad
            ? <div className="skeleton rounded" style={{ width: 72, height: 28, background: 'var(--border)' }} />
            : <SignalChip signal={signal?.signal || row.signal || 'HOLD'} size="lg" />}
          <div className="text-right">
            <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Score</div>
            <div className="text-xl font-bold font-mono" style={{ color: scoreColor }}>{(score * 100).toFixed(1)}%</div>
          </div>
        </div>

        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between mb-2">
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>SIGNAL HISTORY</span>
            {row.price && <span className="text-xs font-mono font-bold" style={{ color: 'var(--text-primary)' }}>₹{Number(row.price).toLocaleString('en-IN')}</span>}
          </div>
          <MiniSparkline data={history} />
        </div>

        {signal?.confidence != null && (
          <div>
            <div className="flex justify-between text-xs font-mono mb-1">
              <span style={{ color: 'var(--text-muted)' }}>Confidence</span>
              <span style={{ color: 'var(--cyan)' }}>{Math.round(signal.confidence * 100)}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <div className="h-full rounded-full" style={{ width: `${signal.confidence * 100}%`, background: 'var(--cyan)', transition: 'width 0.5s' }} />
            </div>
          </div>
        )}

        <div>
          <div className="text-xs font-mono mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Factor Scores</div>
          <div className="grid grid-cols-3 gap-2">
            <StatBlock label="Momentum"   value={row.momentumScore  != null ? (row.momentumScore  * 100).toFixed(1) + '%' : '—'} />
            <StatBlock label="Volatility" value={row.volatilityScore != null ? (row.volatilityScore * 100).toFixed(1) + '%' : '—'} />
            <StatBlock label="Mean Rev."  value={row.mrScore         != null ? (row.mrScore         * 100).toFixed(1) + '%' : '—'} />
          </div>
        </div>

        <div>
          <div className="text-xs font-mono mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Technicals</div>
          <div className="grid grid-cols-2 gap-2">
            <StatBlock label="RSI (14)"
              value={row.rsi != null ? Number(row.rsi).toFixed(1) : '—'}
              color={row.rsi > 70 ? 'var(--red)' : row.rsi < 30 ? 'var(--green)' : 'var(--text-primary)'} />
            <StatBlock label="Z-Score"
              value={(signal?.zScore ?? row.zScore) != null ? Number(signal?.zScore ?? row.zScore).toFixed(3) : '—'}
              color={Math.abs(signal?.zScore ?? row.zScore ?? 0) > 1.5 ? 'var(--amber)' : 'var(--text-primary)'} />
            <StatBlock label="MA Fast" value={signal?.maFast != null ? `₹${Number(signal.maFast).toFixed(0)}` : '—'} />
            <StatBlock label="MA Slow" value={signal?.maSlow != null ? `₹${Number(signal.maSlow).toFixed(0)}` : '—'} />
          </div>
        </div>

        {row.rsi != null && (
          <div className="p-3 rounded-lg text-xs font-mono"
            style={{
              background: row.rsi > 70 ? 'color-mix(in srgb, var(--red) 8%, transparent)' : row.rsi < 30 ? 'color-mix(in srgb, var(--green) 8%, transparent)' : 'var(--bg-card)',
              border: `1px solid ${row.rsi > 70 ? 'color-mix(in srgb, var(--red) 30%, transparent)' : row.rsi < 30 ? 'color-mix(in srgb, var(--green) 30%, transparent)' : 'var(--border)'}`,
              color: row.rsi > 70 ? 'var(--red)' : row.rsi < 30 ? 'var(--green)' : 'var(--text-muted)',
            }}>
            {row.rsi > 70 ? '⚠ Overbought — RSI above 70' : row.rsi < 30 ? '✓ Oversold — potential buy zone' : 'RSI in neutral zone (30–70)'}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={() => onBacktest(row.symbol)}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{ background: 'color-mix(in srgb, var(--cyan) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--cyan) 40%, transparent)', color: 'var(--cyan)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--cyan) 20%, transparent)'}
            onMouseLeave={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--cyan) 12%, transparent)'}>
            <Play size={13} /> Backtest {row.symbol}
          </button>
          <button
            onClick={() => { setSigLoad(true); signalAPI.get(row.symbol).then(r => setSignal(r.data)).catch(() => {}).finally(() => setSigLoad(false)); }}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-xs font-mono transition-all"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-bright)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
            <Zap size={11} /> {sigLoad ? 'Loading...' : 'Refresh Signal'}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}

export default function Screener() {
  const navigate = useNavigate();
  const [results,     setResults]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [filter,      setFilter]      = useState('ALL');
  const [topN,        setTopN]        = useState(20);
  const [sortKey,     setSortKey]     = useState('compositeScore');
  const [sortAsc,     setSortAsc]     = useState(false);
  const [search,      setSearch]      = useState('');
  const [toast,       setToast]       = useState(null);
  const [showWeights, setShowWeights] = useState(false);
  const [selected,    setSelected]    = useState(null);
  const [weights,     setWeights]     = useState({ wMomentum: 0.40, wVolatility: 0.30, wMR: 0.30 });

  useEffect(() => { fetchScreener(); }, [filter, topN]);

  async function fetchScreener() {
    setLoading(true);
    try {
      const res = await screenerAPI.run({ filter, topN, ...weights });
      setResults(res.data.data || []);
    } catch (err) {
      setToast({ message: err.response?.data?.error || 'Screener failed', type: 'error' });
    } finally { setLoading(false); }
  }

  function toggleSort(key) {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  }

  const filtered = results
    .filter(r => !search || r.symbol?.includes(search.toUpperCase()))
    .sort((a, b) => { const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0; return sortAsc ? av - bv : bv - av; });

  const SortIcon = ({ col }) => (
    <ArrowUpDown size={10} style={{ color: sortKey === col ? 'var(--cyan)' : 'var(--text-muted)', display: 'inline', marginLeft: 4 }} />
  );

  const panelOpen = !!selected;

  return (
    <AppShell>
      <main
        className="page-content scr-main"
        data-panel={panelOpen ? 'true' : 'false'}>
        <div className="max-w-screen-xl">

          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Stock Screener</h1>
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Click any row for details · NIFTY 50 universe</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowWeights(v => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all"
                style={{ background: showWeights ? 'color-mix(in srgb, var(--cyan) 10%, transparent)' : 'var(--bg-card)', border: showWeights ? '1px solid color-mix(in srgb, var(--cyan) 35%, transparent)' : '1px solid var(--border)', color: showWeights ? 'var(--cyan)' : 'var(--text-secondary)' }}>
                <SlidersHorizontal size={12} /> Weights
              </button>
              <button onClick={fetchScreener} disabled={loading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-50"
                style={{ background: 'color-mix(in srgb, var(--cyan) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cyan) 30%, transparent)', color: 'var(--cyan)' }}>
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>

          {results.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'BUY Candidates',  count: results.filter(r => r.signal === 'BUY').length,  color: 'var(--green)', icon: TrendingUp },
                { label: 'HOLD',            count: results.filter(r => r.signal === 'HOLD').length, color: 'var(--amber)', icon: Minus },
                { label: 'SELL Candidates', count: results.filter(r => r.signal === 'SELL').length, color: 'var(--red)',   icon: TrendingDown },
              ].map(({ label, count, color, icon: Icon }) => (
                <div key={label} className="rounded-xl p-4 flex items-center gap-3"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 26%, transparent)` }}>
                    <Icon size={14} style={{ color }} />
                  </div>
                  <div>
                    <div className="text-xl font-bold font-mono" style={{ color }}>{count}</div>
                    <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showWeights && (
            <div className="rounded-xl p-4 mb-4 fade-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="text-xs font-mono mb-3 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Factor Weights · sum: {(Number(weights.wMomentum||0) + Number(weights.wVolatility||0) + Number(weights.wMR||0)).toFixed(2)}
              </div>
              <div className="grid grid-cols-3 gap-4">
                {[['wMomentum', 'Momentum'], ['wVolatility', 'Volatility'], ['wMR', 'Mean Reversion']].map(([k, l]) => (
                  <div key={k}>
                    <label className="text-xs font-mono flex justify-between mb-1">
                      <span style={{ color: 'var(--text-muted)' }}>{l}</span>
                      <span style={{ color: 'var(--cyan)' }}>{weights[k]}</span>
                    </label>
                    <input type="range" min="0" max="1" step="0.05" value={weights[k]}
                      onChange={e => setWeights(p => ({ ...p, [k]: +e.target.value }))}
                      className="w-full" style={{ accentColor: 'var(--cyan)' }} />
                  </div>
                ))}
              </div>
              <button onClick={fetchScreener} className="mt-3 px-4 py-1.5 rounded text-xs font-mono"
                style={{ background: 'color-mix(in srgb, var(--cyan) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--cyan) 30%, transparent)', color: 'var(--cyan)' }}>
                Apply & Refresh
              </button>
            </div>
          )}

          <div className="rounded-xl p-4 mb-4 flex flex-wrap items-center gap-3"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="relative flex-1 min-w-40">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter symbol..."
                className="w-full pl-8 pr-3 py-2 rounded-lg text-xs font-mono outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                onFocus={e => e.target.style.borderColor = 'color-mix(in srgb, var(--cyan) 40%, transparent)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
            </div>
            <div className="flex gap-1" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%', paddingBottom: 2 }}>
              {FILTERS.map(f => (
                <button key={f} onClick={() => setFilter(f)} className="px-3 py-1.5 rounded text-xs font-mono transition-all"
                  style={{ whiteSpace: 'nowrap', flexShrink: 0, background: filter === f ? 'color-mix(in srgb, var(--cyan) 12%, transparent)' : 'var(--bg-elevated)', border: filter === f ? '1px solid color-mix(in srgb, var(--cyan) 35%, transparent)' : '1px solid var(--border)', color: filter === f ? 'var(--cyan)' : 'var(--text-muted)' }}>
                  {f.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <select value={topN} onChange={e => setTopN(+e.target.value)} className="px-3 py-1.5 rounded text-xs font-mono outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              {[10, 20, 30, 50].map(n => <option key={n} value={n}>Top {n}</option>)}
            </select>
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{filtered.length} results</span>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            {loading ? (
              <div className="p-8 space-y-2">
                {[...Array(8)].map((_, i) => <div key={i} className="h-10 rounded skeleton" style={{ background: 'var(--bg-elevated)' }} />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono" style={{ minWidth: 760 }}>
                  <thead style={{ borderBottom: '1px solid var(--border)' }}>
                    <tr>
                      {[['#',null],['Symbol','symbol'],['Signal','signal'],['Score','compositeScore'],
                        ['Momentum','momentumScore'],['Volatility','volatilityScore'],['Mean Rev.','mrScore'],
                        ['RSI','rsi'],['Price','price'],['',null]].map(([label, key]) => (
                        <th key={label}
                          className={`text-left py-3 px-4 font-medium uppercase tracking-wider ${key ? 'cursor-pointer select-none' : ''}`}
                          style={{ color: sortKey === key ? 'var(--cyan)' : 'var(--text-muted)' }}
                          onClick={() => key && toggleSort(key)}>
                          {label}{key && <SortIcon col={key} />}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={10} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>No results. Try changing filter or refreshing.</td></tr>
                    ) : filtered.map((row, i) => {
                      const isSel = selected?.symbol === row.symbol;
                      return (
                        <tr key={row.symbol} onClick={() => setSelected(isSel ? null : row)}
                          className="transition-colors cursor-pointer"
                          style={{ borderBottom: '1px solid var(--border)', background: isSel ? 'color-mix(in srgb, var(--cyan) 6%, transparent)' : 'transparent', borderLeft: isSel ? '2px solid var(--cyan)' : '2px solid transparent' }}
                          onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'color-mix(in srgb, var(--cyan) 3%, transparent)'; }}
                          onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                          <td className="py-3 px-4" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                          <td className="py-3 px-4 font-bold" style={{ color: isSel ? 'var(--cyan)' : 'var(--text-primary)' }}>{row.symbol}</td>
                          <td className="py-3 px-4"><SignalChip signal={row.signal} /></td>
                          <td className="py-3 px-4"><ScoreBadge score={row.compositeScore ?? 0} /></td>
                          <td className="py-3 px-4" style={{ color: 'var(--text-secondary)' }}>{row.momentumScore  != null ? (row.momentumScore  * 100).toFixed(1) + '%' : '—'}</td>
                          <td className="py-3 px-4" style={{ color: 'var(--text-secondary)' }}>{row.volatilityScore != null ? (row.volatilityScore * 100).toFixed(1) + '%' : '—'}</td>
                          <td className="py-3 px-4" style={{ color: 'var(--text-secondary)' }}>{row.mrScore         != null ? (row.mrScore         * 100).toFixed(1) + '%' : '—'}</td>
                          <td className="py-3 px-4" style={{ color: row.rsi > 70 ? 'var(--red)' : row.rsi < 30 ? 'var(--green)' : 'var(--text-secondary)' }}>
                            {row.rsi != null ? Number(row.rsi).toFixed(1) : '—'}
                          </td>
                          <td className="py-3 px-4" style={{ color: 'var(--text-primary)' }}>{row.price ? `₹${Number(row.price).toLocaleString('en-IN')}` : '—'}</td>
                          <td className="py-3 px-4" style={{ color: 'var(--text-muted)' }}>
                            <ChevronRight size={13} style={{ transform: isSel ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      <DetailPanel row={selected} onClose={() => setSelected(null)} onBacktest={sym => navigate(`/backtest?symbol=${sym}`)} />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </AppShell>
  );
}
