import { useState, useCallback } from 'react';
import Navbar     from '../components/Navbar';
import Sidebar    from '../components/Sidebar';
import Toast      from '../components/Toast';
import SearchBar  from '../components/SearchBar';
import StockCard  from '../components/StockCard';
import TradePanel from '../components/TradePanel';
import { marketAPI, manualTradeAPI, signalAPI } from '../services/api';
import { Activity, BarChart2, TrendingUp, ShieldCheck, Info } from 'lucide-react';

// ── Recent searches history ───────────────────────────────────────────────────
const MAX_HISTORY = 6;

function HistoryChip({ symbol, onClick }) {
  return (
    <button onClick={() => onClick(symbol)}
      className="font-mono"
      style={{
        padding: '4px 11px', borderRadius: 6, fontSize: 11,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-bright)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
      {symbol}
    </button>
  );
}

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '64px 32px', textAlign: 'center',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%', marginBottom: 20,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Activity size={24} style={{ color: 'var(--text-muted)' }} />
      </div>
      <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Search for a stock to begin
      </p>
      <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 300, lineHeight: 1.6 }}>
        Enter a NSE symbol above to view live price, technical indicators, and execute manual trades
      </p>
    </div>
  );
}

export default function Trade() {
  const [symbol,   setSymbol]   = useState('');
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [toast,    setToast]    = useState(null);
  const [history,  setHistory]  = useState([]);
  const [portfolio, setPortfolio] = useState(null);

  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type });
  }, []);

  // ── Fetch stock data: quote + signal merged ─────────────────────────────────
  const fetchStock = useCallback(async (sym) => {
    if (!sym) return;
    const upper = sym.toUpperCase().trim();
    setLoading(true);
    setData(null);

    try {
      // Fetch quote and signal in parallel
      const [quoteRes, signalRes] = await Promise.allSettled([
        marketAPI.getQuote(upper),
        signalAPI.get(upper),
      ]);

      const quote  = quoteRes.status  === 'fulfilled' ? quoteRes.value.data?.data   : null;
      const signal = signalRes.status === 'fulfilled' ? signalRes.value.data        : null;

      if (!quote && !signal) {
        throw new Error(`No data found for "${upper}"`);
      }

      // Merge quote + signal into one display object
      const merged = {
        symbol:     upper,
        price:      quote?.price ?? quote?.lastPrice,
        source:     quote?.source,
        fetchedAt:  quote?.fetchedAt,
        signal:     signal?.signal     ?? 'HOLD',
        confidence: signal?.confidence ?? null,
        trend:      signal?.regime     ?? signal?.trend,
        rsi:        signal?.rsiValue   ?? signal?.indicators?.rsi,
        maFast:     signal?.maFast     ?? signal?.indicators?.maFast,
        maSlow:     signal?.maSlow     ?? signal?.indicators?.maSlow,
        zScore:     signal?.zScore     ?? signal?.indicators?.zScore,
      };

      setSymbol(upper);
      setData(merged);

      // Update history
      setHistory(prev => {
        const next = [upper, ...prev.filter(s => s !== upper)].slice(0, MAX_HISTORY);
        return next;
      });

      showToast(
        `${upper} loaded · ${merged.signal} signal${merged.confidence != null ? ` · ${(merged.confidence * 100).toFixed(0)}% confidence` : ''}`,
        merged.signal === 'BUY' ? 'success' : merged.signal === 'SELL' ? 'error' : 'info'
      );

    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to fetch stock data';
      showToast(msg, 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // ── Manual trade handler ────────────────────────────────────────────────────
  const handleTrade = useCallback(async ({ symbol: sym, action, qty }) => {
    const res = await manualTradeAPI.place(sym, action, qty);

    // Refresh quote after trade
    setTimeout(() => fetchStock(sym), 800);

    // Update portfolio display if returned
    if (res.data?.portfolio) {
      setPortfolio(res.data.portfolio);
    }

    showToast(
      `${action} order placed — ${qty} × ${sym}`,
      action === 'BUY' ? 'success' : 'error'
    );

    return res;
  }, [fetchStock, showToast]);

  return (
    <div className="page-shell">
      <Navbar />
      <Sidebar />

      <main className="page-content">

        {/* Page header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            Trade
          </h1>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Search stocks · view signals · execute manual orders
          </p>
        </div>

        {/* Search bar + history row */}
        <div style={{ marginBottom: 20 }}>
          <SearchBar onSearch={fetchStock} loading={loading} />

          {history.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span className="section-label">Recent:</span>
              {history.map(sym => (
                <HistoryChip key={sym} symbol={sym} onClick={fetchStock} />
              ))}
            </div>
          )}
        </div>

        {/* Main content */}
        {!data && !loading ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>

            {/* Left column: StockCard + info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <StockCard
                data={data}
                loading={loading}
                onRefresh={symbol ? () => fetchStock(symbol) : undefined}
              />

              {/* Info banner when in simulation mode */}
              {data?.source === 'SIMULATION' && (
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(255,176,32,0.06)',
                  border: '1px solid rgba(255,176,32,0.2)',
                  borderRadius: 8,
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                }}>
                  <Info size={14} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }} />
                  <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Price is simulated (market may be closed or API limit reached).
                    Signal indicators are still computed from historical data.
                  </p>
                </div>
              )}

              {/* Portfolio snapshot (shown after a trade) */}
              {portfolio && (
                <div className="card fade-up" style={{ padding: 20 }}>
                  <div className="section-label" style={{ marginBottom: 12 }}>Portfolio Snapshot</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {[
                      { label: 'Capital',   value: `₹${Number(portfolio.capital || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, icon: TrendingUp },
                      { label: 'Equity',    value: `₹${Number(portfolio.equity  || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, icon: BarChart2 },
                      { label: 'Open P&L',  value: `₹${Number(portfolio.openPnl || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, icon: ShieldCheck },
                    ].map(({ label, value, icon: Icon }) => (
                      <div key={label} style={{
                        padding: '10px 14px', borderRadius: 8,
                        background: 'var(--bg-base)', border: '1px solid var(--border)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <Icon size={11} style={{ color: 'var(--text-muted)' }} />
                          <span className="section-label">{label}</span>
                        </div>
                        <span className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right column: TradePanel */}
            <div style={{ position: 'sticky', top: 'calc(var(--navbar-h) + 24px)' }}>
              <TradePanel
                symbol={data?.symbol ?? symbol}
                currentPrice={data?.price}
                onTrade={handleTrade}
                disabled={loading}
              />
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
          <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </div>
  );
}