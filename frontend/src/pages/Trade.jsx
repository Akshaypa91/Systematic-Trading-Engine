// src/pages/Trade.jsx — fully responsive
import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell     from '../components/AppShell';
import Toast        from '../components/Toast';
import SearchBar    from '../components/SearchBar';
import StockCard    from '../components/StockCard';
import TradePanel   from '../components/TradePanel';
import PortfolioCard from '../components/PortfolioCard';
import CapitalSetup from '../components/CapitalSetup';
import TradingChart from '../components/TradingChart';
import { marketAPI, manualTradeAPI, signalAPI, simAPI, liveAPI } from '../services/api';
import { Activity, Info, Layers, Loader2 } from 'lucide-react';
import LiveOrderModal    from '../components/LiveOrderModal';
import LiveOrderPanel    from '../components/LiveOrderPanel';
import BrokerStatusCard  from '../components/BrokerStatusCard';
import LiveModeBanner    from '../components/LiveModeBanner';
import { useTradingMode } from '../context/TradingModeContext';
import useLivePrice      from '../hooks/useLivePrice';
import { Chip }          from '../components/ui';

const MAX_HISTORY = 8;

export default function Trade() {
  const [symbol,           setSymbol]           = useState('');
  const [data,             setData]             = useState(null);
  const [loading,          setLoading]          = useState(false);
  const [toast,            setToast]            = useState(null);
  const [history,          setHistory]          = useState([]);
  const [portfolioRefresh, setPortfolioRefresh] = useState(0);
  const [initialized,      setInitialized]      = useState(null);
  const [checkingInit,     setCheckingInit]     = useState(true);

  // ── Live trading state (mode + broker come from the shared context) ─────────
  const { mode: tradingMode, brokerLinked, reportBroker } = useTradingMode();
  const [liveModal,     setLiveModal]     = useState(null);   // pending order
  const [liveLoading,   setLiveLoading]   = useState(false);

  // ── Live price feed ─────────────────────────────────────────────────────────
  // Subscribes to the currently displayed symbol over the shared WebSocket and
  // returns continuously-updating ticks. Symbol changes are handled inside the
  // hook (unsubscribe old → subscribe new).
  const live = useLivePrice(data?.symbol);

  async function confirmLiveOrder() {
    if (!liveModal) return;
    setLiveLoading(true);
    try {
      const res = await liveAPI.placeOrder({ ...liveModal, confirmed: true });
      const sbx = res.data?.sandbox ? ' (SANDBOX)' : '';
      setToast({ msg: `Live order placed${sbx}: ${liveModal.side} ${liveModal.qty}×${liveModal.symbol}`, type: 'success' });
      setLiveModal(null);
      setPortfolioRefresh(n => n + 1);
    } catch (err) {
      setToast({ msg: err.response?.data?.error || err.message, type: 'error' });
    } finally {
      setLiveLoading(false);
    }
  }

  useEffect(() => {
    async function checkPortfolio() {
      try {
        const res  = await simAPI.getPortfolio();
        const port = res.data?.data ?? res.data ?? {};
        setInitialized(port.initialized === true);
      } catch { setInitialized(false); }
      finally  { setCheckingInit(false); }
    }
    checkPortfolio();
  }, []);

  const showToast = useCallback((msg, type = 'info') => setToast({ msg, type }), []);

  function handleInitialized(portfolio) {
    setInitialized(true);
    setPortfolioRefresh(n => n + 1);
    showToast(`Portfolio ready · ₹${Number(portfolio?.capital ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, 'success');
  }
  function handleReset(portfolio) {
    setPortfolioRefresh(n => n + 1);
    showToast(`Portfolio reset · ₹${Number(portfolio?.capital ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} restored`, 'info');
  }

  // Deep link: /trade?symbol=RELIANCE (from ⌘K palette / dashboard links).
  // Fetch once after the portfolio-initialized check settles.
  const [searchParams] = useSearchParams();
  const deepLinkDone = useRef(false);

  const fetchStock = useCallback(async (sym) => {
    // Guard: only accept valid NSE symbol format (letters, digits, hyphen, &)
    // Reject company names like "Bajaj Consumer Care Ltd"
    const upper = sym.toUpperCase().trim();
    if (!upper || upper.length > 20 || upper.includes(' ')) {
      showToast(`"${sym}" is not a valid NSE symbol. Select from the dropdown.`, 'error');
      return;
    }
    setLoading(true); setData(null);
    try {
      const [quoteRes, signalRes] = await Promise.allSettled([
        marketAPI.getQuote(upper), signalAPI.get(upper),
      ]);
      const quote  = quoteRes.status  === 'fulfilled' ? quoteRes.value.data?.data : null;
      const signal = signalRes.status === 'fulfilled' ? signalRes.value.data      : null;
      if (!quote && !signal) throw new Error(`No data found for "${upper}"`);
      const merged = {
        symbol: upper, price: quote?.price ?? quote?.lastPrice,
        source: quote?.source, fetchedAt: quote?.fetchedAt,
        signal: signal?.signal ?? 'HOLD', confidence: signal?.confidence ?? null,
        trend: signal?.regime ?? signal?.trend, rsi: signal?.rsiValue ?? null,
        maFast: signal?.maFast ?? null, maSlow: signal?.maSlow ?? null, zScore: signal?.zScore ?? null,
      };
      setSymbol(upper); setData(merged);
      setHistory(prev => [upper, ...prev.filter(s => s !== upper)].slice(0, MAX_HISTORY));
      const sigType = merged.signal === 'BUY' ? 'success' : merged.signal === 'SELL' ? 'error' : 'info';
      showToast(`${upper} · ${merged.signal}${merged.confidence != null ? ` · ${(merged.confidence * 100).toFixed(0)}% confidence` : ''}`, sigType);
    } catch (err) {
      showToast(err.response?.data?.error || err.message || 'Failed', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => {
    const sym = searchParams.get('symbol');
    if (sym && initialized && !deepLinkDone.current) {
      deepLinkDone.current = true;
      fetchStock(sym);
    }
  }, [searchParams, initialized, fetchStock]);

  const handleTrade = useCallback(async ({ symbol: sym, action, qty }) => {
    const res = await manualTradeAPI.place(sym, action, qty);
    setPortfolioRefresh(n => n + 1);
    setTimeout(() => fetchStock(sym), 600);
    showToast(`${action} order placed — ${qty} × ${sym}`, action === 'BUY' ? 'success' : 'error');
    return res;
  }, [fetchStock, showToast]);

  // Merge the live tick over the one-shot REST quote so the LTP + timestamp
  // update on every WebSocket tick instead of freezing at fetch time.
  const displayData = data
    ? {
        ...data,
        price:     live.price ?? data.price,
        source:    live.isLive ? live.source : data.source,
        fetchedAt: live.ts ?? data.fetchedAt,
      }
    : data;
  const isSimSource = displayData?.source === 'SIMULATION' || displayData?.source === 'SIM';

  const ToastEl = toast && (
    <div style={{ position: 'fixed', bottom: 24, right: 16, zIndex: 9999, maxWidth: 'calc(100vw - 32px)' }}>
      <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
    </div>
  );

  if (checkingInit) {
    return (
      <AppShell>
        <main className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - var(--navbar-h))' }}>
          <Loader2 size={20} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
        </main>
      </AppShell>
    );
  }

  if (!initialized) {
    return (
      <AppShell>
        <main className="page-content"><CapitalSetup onInitialized={handleInitialized} /></main>
        {ToastEl}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="page-content trade-page-content">

        {/* LIVE (real money) banner — only visible in LIVE mode */}
        <LiveModeBanner active={tradingMode === 'LIVE'} />

        {/* Page header */}
        <div className="trade-page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Layers size={18} style={{ color: 'var(--cyan)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Trade</h1>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`ws-pill ${brokerLinked ? 'connected' : ''}`} title={brokerLinked ? 'Upstox connected' : 'Upstox not connected'}>
                ● {brokerLinked ? 'Upstox connected' : 'Broker offline'}
              </span>
            </div>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 28 }}>
            Search stocks · view signals · execute manual orders
          </p>
        </div>

        {/* Search + recent */}
        <div style={{ marginBottom: 16 }}>
          <SearchBar onSearch={fetchStock} loading={loading} />
          {history.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <span className="section-label">Recent:</span>
              {history.map(sym => (
                <Chip key={sym} active={sym === symbol} onClick={() => fetchStock(sym)}>
                  {sym}
                </Chip>
              ))}
            </div>
          )}
        </div>

        {/* Empty state */}
        {!data && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px 20px', textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, marginBottom: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={20} style={{ color: 'var(--text-muted)' }} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Search for a stock to begin</p>
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 280, lineHeight: 1.7 }}>
                Enter an NSE symbol above to view price, signals, and execute trades
              </p>
            </div>
            <BrokerStatusCard onStatusChange={reportBroker} />
            <PortfolioCard refreshTrigger={portfolioRefresh} onReset={handleReset} />
          </div>
        )}

        {/* ── Main trading layout ── */}
        {(data || loading) && (
          <div className="trade-grid">

            {/* Left column: stock info + chart + portfolio */}
            <div className="trade-left">
              <StockCard data={displayData} loading={loading} onRefresh={symbol ? () => fetchStock(symbol) : undefined} />

              {data?.symbol && <TradingChart symbol={data.symbol} priceSource={displayData?.source} />}

              {isSimSource && (
                <div style={{ padding: '10px 14px', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10, background: 'color-mix(in srgb, var(--amber) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 20%, transparent)' }}>
                  <Info size={13} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }} />
                  <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Showing simulated price — market may be closed or API rate limit reached.
                  </p>
                </div>
              )}

              <PortfolioCard refreshTrigger={portfolioRefresh} onReset={handleReset} />
            </div>

            {/* Right column: broker status + order panel (LIVE → real order ticket) */}
            <div className="trade-right" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <BrokerStatusCard onStatusChange={reportBroker} />
              {tradingMode === 'LIVE' ? (
                <LiveOrderPanel
                  symbol={data?.symbol ?? symbol}
                  currentPrice={displayData?.price}
                  onReview={(o) => setLiveModal(o)}
                  disabled={loading || !brokerLinked}
                />
              ) : (
                <TradePanel
                  symbol={data?.symbol ?? symbol}
                  currentPrice={displayData?.price}
                  onTrade={handleTrade}
                  disabled={loading}
                />
              )}
            </div>

          </div>
        )}
      </main>
      {ToastEl}
      <LiveOrderModal
        order={liveModal}
        onConfirm={confirmLiveOrder}
        onCancel={() => setLiveModal(null)}
        loading={liveLoading}
      />
    </AppShell>
  );
}
