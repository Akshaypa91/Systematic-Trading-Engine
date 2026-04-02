import { useState, useEffect } from 'react';
import { screenerAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import { Search, RefreshCw, TrendingUp, TrendingDown, Minus, ArrowUpDown, SlidersHorizontal } from 'lucide-react';

const FILTERS = ['ALL', 'BUY_CANDIDATES', 'SELL_CANDIDATES', 'NEUTRAL'];

function ScoreBadge({ score }) {
  const pct = (score * 100).toFixed(1);
  const color = score > 0.6 ? 'var(--accent-green)' : score > 0.4 ? 'var(--accent-amber)' : 'var(--accent-red)';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono w-10" style={{ color }}>{pct}%</span>
    </div>
  );
}

function SignalChip({ signal }) {
  const map = {
    BUY:  { bg: 'rgba(0,230,118,0.12)', color: 'var(--accent-green)', icon: TrendingUp },
    SELL: { bg: 'rgba(255,71,87,0.12)',  color: 'var(--accent-red)',   icon: TrendingDown },
    HOLD: { bg: 'rgba(255,167,38,0.12)', color: 'var(--accent-amber)', icon: Minus },
  };
  const c = map[signal] || map.HOLD;
  const Icon = c.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold"
      style={{ background: c.bg, color: c.color }}>
      <Icon size={10} />{signal}
    </span>
  );
}

export default function Screener() {
  const [results,  setResults]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [filter,   setFilter]   = useState('ALL');
  const [topN,     setTopN]     = useState(20);
  const [sortKey,  setSortKey]  = useState('compositeScore');
  const [sortAsc,  setSortAsc]  = useState(false);
  const [search,   setSearch]   = useState('');
  const [toast,    setToast]    = useState(null);
  const [showWeights, setShowWeights] = useState(false);
  const [weights, setWeights] = useState({ wMomentum: 0.40, wVolatility: 0.30, wMR: 0.30 });

  useEffect(() => { fetchScreener(); }, [filter, topN]);

  async function fetchScreener() {
    setLoading(true);
    try {
      const res = await screenerAPI.run({ filter, topN, ...weights });
      setResults(res.data.data || []);
    } catch (err) {
      setToast({ message: err.response?.data?.error || 'Screener failed', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function toggleSort(key) {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  }

  const filtered = results
    .filter(r => !search || r.symbol?.includes(search.toUpperCase()))
    .sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      return sortAsc ? av - bv : bv - av;
    });

  const SortIcon = ({ col }) => (
    <ArrowUpDown size={10}
      style={{ color: sortKey === col ? 'var(--accent-cyan)' : 'var(--text-muted)', display: 'inline', marginLeft: 4 }} />
  );

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Navbar />
      <Sidebar />

      <main className="ml-48 pt-14 min-h-screen">
        <div className="p-6 max-w-screen-xl">
          {/* Header */}
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Stock Screener</h1>
              <p className="text-sm font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                NIFTY 50 universe · Multi-factor scoring
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setShowWeights(v => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <SlidersHorizontal size={12} /> Weights
              </button>
              <button onClick={fetchScreener} disabled={loading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-50"
                style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: 'var(--accent-cyan)' }}>
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>

          {/* Weight editor */}
          {showWeights && (
            <div className="rounded-xl p-4 mb-4 fade-in"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="grid grid-cols-3 gap-4">
                {[['wMomentum', 'Momentum'], ['wVolatility', 'Volatility'], ['wMR', 'Mean Reversion']].map(([k, l]) => (
                  <div key={k}>
                    <label className="text-xs font-mono block mb-1" style={{ color: 'var(--text-muted)' }}>{l}: {weights[k]}</label>
                    <input type="range" min="0" max="1" step="0.05"
                      value={weights[k]}
                      onChange={e => setWeights(p => ({ ...p, [k]: +e.target.value }))}
                      className="w-full accent-cyan-400" />
                  </div>
                ))}
              </div>
              <button onClick={fetchScreener}
                className="mt-3 px-4 py-1.5 rounded text-xs font-mono transition-all"
                style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: 'var(--accent-cyan)' }}>
                Apply Weights
              </button>
            </div>
          )}

          {/* Controls bar */}
          <div className="rounded-xl p-4 mb-4 flex flex-wrap items-center gap-3"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="relative flex-1 min-w-40">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Filter symbol..."
                className="w-full pl-8 pr-3 py-2 rounded-lg text-xs font-mono outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                onFocus={e => e.target.style.borderColor = 'rgba(0,212,255,0.4)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
            </div>

            <div className="flex gap-1">
              {FILTERS.map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className="px-3 py-1.5 rounded text-xs font-mono transition-all"
                  style={{
                    background: filter === f ? 'rgba(0,212,255,0.12)' : 'var(--bg-elevated)',
                    border: filter === f ? '1px solid rgba(0,212,255,0.35)' : '1px solid var(--border)',
                    color: filter === f ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  }}>
                  {f.replace('_', ' ')}
                </button>
              ))}
            </div>

            <select value={topN} onChange={e => setTopN(+e.target.value)}
              className="px-3 py-1.5 rounded text-xs font-mono outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              {[10, 20, 30, 50].map(n => <option key={n} value={n}>Top {n}</option>)}
            </select>

            <span className="text-xs font-mono ml-auto" style={{ color: 'var(--text-muted)' }}>
              {filtered.length} results
            </span>
          </div>

          {/* Table */}
          <div className="rounded-xl overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            {loading ? (
              <div className="p-8 space-y-2">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-10 rounded skeleton" style={{ background: 'var(--bg-elevated)' }} />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead style={{ borderBottom: '1px solid var(--border)' }}>
                    <tr>
                      {[
                        ['#', null],
                        ['Symbol', 'symbol'],
                        ['Signal', 'signal'],
                        ['Score', 'compositeScore'],
                        ['Momentum', 'momentumScore'],
                        ['Volatility', 'volatilityScore'],
                        ['Mean Rev.', 'mrScore'],
                        ['RSI', 'rsi'],
                        ['Price', 'price'],
                      ].map(([label, key]) => (
                        <th key={label}
                          className={`text-left py-3 px-4 font-medium uppercase tracking-wider ${key ? 'cursor-pointer select-none' : ''}`}
                          style={{ color: sortKey === key ? 'var(--accent-cyan)' : 'var(--text-muted)' }}
                          onClick={() => key && toggleSort(key)}>
                          {label}{key && <SortIcon col={key} />}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                          No results. Try changing the filter or refreshing.
                        </td>
                      </tr>
                    ) : filtered.map((row, i) => (
                      <tr key={row.symbol} className="tr-hover transition-colors"
                        style={{ borderBottom: '1px solid rgba(30,45,69,0.5)' }}>
                        <td className="py-3 px-4" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                        <td className="py-3 px-4 font-bold" style={{ color: 'var(--text-primary)' }}>{row.symbol}</td>
                        <td className="py-3 px-4"><SignalChip signal={row.signal} /></td>
                        <td className="py-3 px-4"><ScoreBadge score={row.compositeScore ?? 0} /></td>
                        <td className="py-3 px-4" style={{ color: 'var(--text-secondary)' }}>
                          {row.momentumScore != null ? (row.momentumScore * 100).toFixed(1) + '%' : '—'}
                        </td>
                        <td className="py-3 px-4" style={{ color: 'var(--text-secondary)' }}>
                          {row.volatilityScore != null ? (row.volatilityScore * 100).toFixed(1) + '%' : '—'}
                        </td>
                        <td className="py-3 px-4" style={{ color: 'var(--text-secondary)' }}>
                          {row.mrScore != null ? (row.mrScore * 100).toFixed(1) + '%' : '—'}
                        </td>
                        <td className="py-3 px-4" style={{ color: row.rsi > 70 ? 'var(--accent-red)' : row.rsi < 30 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                          {row.rsi != null ? Number(row.rsi).toFixed(1) : '—'}
                        </td>
                        <td className="py-3 px-4" style={{ color: 'var(--text-primary)' }}>
                          {row.price ? `₹${Number(row.price).toLocaleString('en-IN')}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </div>
  );
}
