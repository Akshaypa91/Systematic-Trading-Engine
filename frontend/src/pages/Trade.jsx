// src/pages/Trade.jsx
import { useState, useCallback, useEffect } from 'react';
import Navbar        from '../components/Navbar';
import Sidebar       from '../components/Sidebar';
import Toast         from '../components/Toast';
import SearchBar     from '../components/SearchBar';
import StockCard     from '../components/StockCard';
import TradePanel    from '../components/TradePanel';
import PortfolioCard from '../components/PortfolioCard';
import CapitalSetup  from '../components/CapitalSetup';
import { marketAPI, manualTradeAPI, signalAPI, simAPI } from '../services/api';
import { Activity, Info, Layers, Loader2 } from 'lucide-react';

const MAX_HISTORY = 8;

export default function Trade() {
  const [symbol,           setSymbol]           = useState('');
  const [data,             setData]             = useState(null);
  const [loading,          setLoading]          = useState(false);
  const [toast,            setToast]            = useState(null);
  const [history,          setHistory]          = useState([]);
  const [portfolioRefresh, setPortfolioRefresh] = useState(0);

  // ── Portfolio init state ───────────────────────────────────────────────────
  const [initialized,     setInitialized]     = useState(null); // null = loading
  const [checkingInit,    setCheckingInit]    = useState(true);

  // On mount, check if portfolio is already initialized
  useEffect(() => {
    async function checkPortfolio() {
      try {
        const res = await simAPI.getPortfolio();
        const port = res.data?.data ?? res.data ?? {};
        setInitialized(port.initialized === true);
      } catch {
        setInitialized(false);
      } finally {
        setCheckingInit(false);
      }
    }
    checkPortfolio();
  }, []);

  const showToast = useCallback((msg, type = 'info') => setToast({ msg, type }), []);

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleInitialized(portfolio) {
    setInitialized(true);
    setPortfolioRefresh(n => n + 1);
    showToast(
      `Portfolio ready · ₹${Number(portfolio?.capital ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      'success',
    );
  }

  function handleReset(portfolio) {
    setPortfolioRefresh(n => n + 1);
    showToast(
      `Portfolio reset · ₹${Number(portfolio?.capital ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} restored`,
      'info',
    );
  }

  const fetchStock = useCallback(async (sym) => {
    const upper = sym.toUpperCase().trim();
    setLoading(true);
    setData(null);
    try {
      const [quoteRes, signalRes] = await Promise.allSettled([
        marketAPI.getQuote(upper),
        signalAPI.get(upper),
      ]);
      const quote  = quoteRes.status  === 'fulfilled' ? quoteRes.value.data?.data : null;
      const signal = signalRes.status === 'fulfilled' ? signalRes.value.data      : null;

      if (!quote && !signal) throw new Error(`No data found for "${upper}"`);

      const merged = {
        symbol:     upper,
        price:      quote?.price ?? quote?.lastPrice,
        source:     quote?.source,
        fetchedAt:  quote?.fetchedAt,
        signal:     signal?.signal     ?? 'HOLD',
        confidence: signal?.confidence ?? null,
        trend:      signal?.regime     ?? signal?.trend,
        rsi:        signal?.rsiValue   ?? null,
        maFast:     signal?.maFast     ?? null,
        maSlow:     signal?.maSlow     ?? null,
        zScore:     signal?.zScore     ?? null,
      };

      setSymbol(upper);
      setData(merged);
      setHistory(prev => [upper, ...prev.filter(s => s !== upper)].slice(0, MAX_HISTORY));

      const sigType = merged.signal === 'BUY' ? 'success' : merged.signal === 'SELL' ? 'error' : 'info';
      showToast(
        `${upper} · ${merged.signal}${merged.confidence != null
          ? ` · ${(merged.confidence * 100).toFixed(0)}% confidence` : ''}`,
        sigType,
      );
    } catch (err) {
      showToast(err.response?.data?.error || err.message || 'Failed', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const handleTrade = useCallback(async ({ symbol: sym, action, qty }) => {
    const res = await manualTradeAPI.place(sym, action, qty);
    setPortfolioRefresh(n => n + 1);
    setTimeout(() => fetchStock(sym), 600);
    showToast(
      `${action} order placed — ${qty} × ${sym}`,
      action === 'BUY' ? 'success' : 'error',
    );
    return res;
  }, [fetchStock, showToast]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Checking portfolio state on mount
  if (checkingInit) {
    return (
      <div className="page-shell">
        <Navbar />
        <Sidebar />
        <main className="page-content" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 'calc(100vh - var(--navbar-h))',
        }}>
          <Loader2 size={20} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
        </main>
      </div>
    );
  }

  // Portfolio not initialized — show capital setup screen
  if (!initialized) {
    return (
      <div className="page-shell">
        <Navbar />
        <Sidebar />
        <main className="page-content">
          <CapitalSetup onInitialized={handleInitialized} />
        </main>
        {toast && (
          <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
            <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
          </div>
        )}
      </div>
    );
  }

  // Portfolio initialized — show full trading UI
  return (
    <div className="page-shell">
      <Navbar />
      <Sidebar />
      <main className="page-content">

        {/* Page header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Layers size={18} style={{ color: 'var(--cyan)' }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Trade</h1>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 28 }}>
            Search stocks · view signals · execute manual orders
          </p>
        </div>

        {/* Search + recent */}
        <div style={{ marginBottom: 20 }}>
          <SearchBar onSearch={fetchStock} loading={loading} />
          {history.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span className="section-label">Recent:</span>
              {history.map(sym => (
                <button key={sym} onClick={() => fetchStock(sym)} className="font-mono" style={{
                  padding: '3px 10px', borderRadius: 6, fontSize: 11,
                  background: sym === symbol ? 'rgba(0,212,255,0.10)' : 'var(--bg-elevated)',
                  border: `1px solid ${sym === symbol ? 'rgba(0,212,255,0.30)' : 'var(--border)'}`,
                  color: sym === symbol ? 'var(--cyan)' : 'var(--text-secondary)',
                  cursor: 'pointer', transition: 'all 0.12s',
                }}>
                  {sym}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Empty state — show portfolio even with no stock selected */}
        {!data && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '48px 32px 24px', textAlign: 'center',
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: 14, marginBottom: 16,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Activity size={20} style={{ color: 'var(--text-muted)' }} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Search for a stock to begin
              </p>
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 300, lineHeight: 1.7 }}>
                Enter an NSE symbol above to view live price, technical signals, and execute manual trades
              </p>
            </div>

            <PortfolioCard
              refreshTrigger={portfolioRefresh}
              onReset={handleReset}
            />
          </div>
        )}

        {/* Main trading grid */}
        {(data || loading) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>

            {/* Left: StockCard + Portfolio */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <StockCard
                data={data}
                loading={loading}
                onRefresh={symbol ? () => fetchStock(symbol) : undefined}
              />

              {data?.source === 'SIMULATION' && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8,
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  background: 'rgba(255,176,32,0.06)',
                  border: '1px solid rgba(255,176,32,0.20)',
                }}>
                  <Info size={13} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }} />
                  <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Showing simulated price — market may be closed or API rate limit reached.
                  </p>
                </div>
              )}

              <PortfolioCard
                refreshTrigger={portfolioRefresh}
                onReset={handleReset}
              />
            </div>

            {/* Right: Trade panel (sticky) */}
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