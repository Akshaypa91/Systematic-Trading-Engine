// src/components/TradingChart.jsx
// ─────────────────────────────────────────────────────────────────────────────
// TradingView Advanced Chart — NSE symbols, dark theme.
// Fullscreen toggle. Fixes Apple/Cboe bug by forcing NSE: prefix.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, memo, useState, useCallback } from 'react';
import { BarChart2, Maximize2, Minimize2 } from 'lucide-react';

// Force NSE exchange — prevents TradingView defaulting to US/Cboe listings
function toTVSymbol(symbol) {
  if (!symbol) return 'NSE:NIFTY';
  const s = symbol.toUpperCase().trim();
  if (s.includes(':')) return s;
  if (s === 'NIFTY' || s === 'NIFTY50') return 'NSE:NIFTY';
  if (s === 'BANKNIFTY')               return 'NSE:BANKNIFTY';
  if (s === 'SENSEX')                  return 'BSE:SENSEX';
  return `NSE:${s}`;
}

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

function TradingChart({ symbol, height }) {
  const containerRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);

  const buildWidget = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'tradingview-widget-container__widget';
    wrapper.style.cssText = 'height:100%;width:100%;';
    container.appendChild(wrapper);

    const script       = document.createElement('script');
    script.src         = SCRIPT_SRC;
    script.async       = true;
    script.type        = 'text/javascript';
    script.innerHTML   = JSON.stringify({
      autosize:            true,
      symbol:              toTVSymbol(symbol),   // ← always NSE:SYMBOL
      interval:            'D',
      timezone:            'Asia/Kolkata',
      theme:               'dark',
      style:               '1',                  // candlestick
      locale:              'en',
      backgroundColor:     '#060a12',
      gridColor:           'rgba(255,255,255,0.04)',
      hide_top_toolbar:    false,
      hide_legend:         false,
      withdateranges:      true,
      allow_symbol_change: false,
      save_image:          false,
      calendar:            false,
      hide_volume:         false,
      support_host:        'https://www.tradingview.com',
      studies:             ['STD;RSI', 'STD;MACD'],
    });
    container.appendChild(script);
  }, [symbol]);

  // Rebuild widget whenever symbol OR fullscreen changes (height changes need rebuild)
  useEffect(() => {
    buildWidget();
    return () => { if (containerRef.current) containerRef.current.innerHTML = ''; };
  }, [buildWidget, fullscreen]);

  const tvSymbol = toTVSymbol(symbol);

  // ── Fullscreen overlay styles ────────────────────────────────────────────────
  const wrapStyle = fullscreen ? {
    position:   'fixed',
    inset:      0,
    zIndex:     9999,
    background: '#060a12',
    display:    'flex',
    flexDirection: 'column',
  } : {
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    display: 'flex',
    flexDirection: 'column',
  };

  const chartHeight = fullscreen ? 'calc(100vh - 52px)' : (height || '100%');

  return (
    <div style={wrapStyle}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        background: fullscreen ? '#0a0f1e' : undefined,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'rgba(0,212,255,0.08)',
            border: '1px solid rgba(0,212,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BarChart2 size={13} style={{ color: 'var(--cyan)' }} />
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 1 }}>Live Chart</div>
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {tvSymbol} · TradingView
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* LIVE badge */}
          <div style={{
            padding: '3px 9px', borderRadius: 6,
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
            background: 'rgba(0,229,160,0.08)',
            border: '1px solid rgba(0,229,160,0.20)',
            color: 'var(--green)',
          }}>
            ● LIVE
          </div>

          {/* Fullscreen toggle */}
          <button
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border)',
              background: fullscreen ? 'rgba(0,212,255,0.10)' : 'var(--bg-elevated)',
              color: fullscreen ? 'var(--cyan)' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--border-bright)';
              e.currentTarget.style.color = 'var(--cyan)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = fullscreen ? 'var(--cyan)' : 'var(--text-secondary)';
            }}
          >
            {fullscreen
              ? <Minimize2 size={13} />
              : <Maximize2 size={13} />
            }
          </button>
        </div>
      </div>

      {/* Widget */}
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ width: '100%', height: fullscreen ? chartHeight : undefined, minHeight: fullscreen ? undefined : 360, flex: fullscreen ? 1 : undefined }}
      />

      {/* ESC hint in fullscreen */}
      {fullscreen && (
        <div
          onClick={() => setFullscreen(false)}
          style={{
            position: 'absolute', top: 14, right: 58,
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--text-dim)', cursor: 'pointer',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

export default memo(TradingChart);
