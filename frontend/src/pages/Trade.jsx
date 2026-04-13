import { useState, useCallback } from 'react';
import Navbar     from '../components/Navbar';
import Sidebar    from '../components/Sidebar';
import Toast      from '../components/Toast';
import SearchBar  from '../components/SearchBar';
import StockCard  from '../components/StockCard';
import TradePanel from '../components/TradePanel';
import { marketAPI, manualTradeAPI, signalAPI } from '../services/api';
import { Activity, Info } from 'lucide-react';

const MAX_HISTORY = 8;

export default function Trade() {
  const [symbol,   setSymbol]   = useState('');
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [toast,    setToast]    = useState(null);
  const [history,  setHistory]  = useState([]);

  const showToast = useCallback((msg, type = 'info') => setToast({ msg, type }), []);

  const fetchStock = useCallback(async (sym) => {
    const upper = sym.toUpperCase().trim();
    setLoading(true); setData(null);
    try {
      const [quoteRes, signalRes] = await Promise.allSettled([
        marketAPI.getQuote(upper),
        signalAPI.get(upper),
      ]);
      const quote  = quoteRes.status  === 'fulfilled' ? quoteRes.value.data?.data   : null;
      const signal = signalRes.status === 'fulfilled' ? signalRes.value.data        : null;

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
      showToast(`${upper} · ${merged.signal}${merged.confidence != null ? ` · ${(merged.confidence*100).toFixed(0)}% confidence` : ''}`, sigType);
    } catch (err) {
      showToast(err.response?.data?.error || err.message || 'Failed', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const handleTrade = useCallback(async ({ symbol: sym, action, qty }) => {
    const res = await manualTradeAPI.place(sym, action, qty);
    setTimeout(() => fetchStock(sym), 600);
    showToast(`${action} order placed — ${qty} × ${sym}`, action === 'BUY' ? 'success' : 'error');
    return res;
  }, [fetchStock, showToast]);

  return (
    <div className="page-shell">
      <Navbar />
      <Sidebar />
      <main className="page-content">

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Trade</h1>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Search stocks · view signals · execute manual orders
          </p>
        </div>

        {/* Search + history */}
        <div style={{ marginBottom: 20 }}>
          <SearchBar onSearch={fetchStock} loading={loading} />
          {history.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span className="section-label">Recent:</span>
              {history.map(sym => (
                <button key={sym} onClick={() => fetchStock(sym)} className="font-mono" style={{
                  padding: '3px 10px', borderRadius: 5, fontSize: 11,
                  background: sym === symbol ? 'rgba(0,212,255,0.10)' : 'var(--bg-elevated)',
                  border: `1px solid ${sym === symbol ? 'rgba(0,212,255,0.3)' : 'var(--border)'}`,
                  color: sym === symbol ? 'var(--cyan)' : 'var(--text-secondary)',
                  cursor: 'pointer', transition: 'all 0.12s',
                }}>
                  {sym}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Empty state */}
        {!data && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 32px', textAlign: 'center' }}>
            <div style={{
              width: 60, height: 60, borderRadius: '50%', marginBottom: 20,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Activity size={22} style={{ color: 'var(--text-muted)' }} />
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Search for a stock to begin
            </p>
            <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 320, lineHeight: 1.6 }}>
              Enter an NSE symbol above to view live price, technical signals, and execute manual trades
            </p>
          </div>
        )}

        {/* Main content */}
        {(data || loading) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <StockCard data={data} loading={loading} onRefresh={symbol ? () => fetchStock(symbol) : undefined} />

              {data?.source === 'SIMULATION' && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10,
                  background: 'rgba(255,176,32,0.06)', border: '1px solid rgba(255,176,32,0.20)',
                }}>
                  <Info size={13} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }} />
                  <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Showing simulated price — market may be closed or API rate limit reached.
                  </p>
                </div>
              )}
            </div>

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