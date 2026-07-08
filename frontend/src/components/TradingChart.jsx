// src/components/TradingChart.jsx
// ─────────────────────────────────────────────────────────────────────────────
// TradingView Advanced Chart — NSE symbols, dark theme.
//
// Symbol format rule (mirrors backend symbolMap.js):
//   TradingView requires "NSE:SYMBOL"  e.g. NSE:TCS, NSE:INFY
//   Without NSE: prefix → TradingView defaults to US listings (AAPL etc.)
//
// CRITICAL FIX: script.textContent must be set BEFORE the script tag is
// appended to the DOM. TradingView reads the config at execution time.
// Setting innerHTML/textContent after append has no effect.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, memo, useState, useCallback } from 'react';
import { BarChart2, Maximize2, Minimize2 } from 'lucide-react';
import { useThemeContext } from '../context/ThemeContext';

// ── Frontend symbol → TradingView format ──────────────────────────────────────
// Mirrors backend symbolMap.toTV() without importing Node modules.
// Any symbol already prefixed is passed through; plain symbols get NSE: added.

const TV_OVERRIDES = {
  'M&M':    'NSE:MM',
  'NIFTY':  'NSE:NIFTY',
  'NIFTY50':'NSE:NIFTY',
  'SENSEX': 'BSE:SENSEX',
};

function toTVSymbol(symbol) {
  if (!symbol) return 'NSE:NIFTY';
  const s = symbol.toUpperCase().trim();
  if (s.includes(':')) return s;                 // already has exchange prefix
  if (TV_OVERRIDES[s]) return TV_OVERRIDES[s];  // special case mapping
  return `NSE:${s}`;                             // default: NSE equity
}

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

function buildWidgetConfig(tvSymbol, isDark) {
  return {
    autosize:            true,
    symbol:              tvSymbol,
    interval:            'D',
    timezone:            'Asia/Kolkata',
    theme:               isDark ? 'dark' : 'light',
    style:               '1',
    locale:              'en',
    backgroundColor:     isDark ? '#060a12' : '#ffffff',
    gridColor:           isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    hide_top_toolbar:    false,
    hide_legend:         false,
    withdateranges:      true,
    allow_symbol_change: false,
    save_image:          false,
    calendar:            false,
    hide_volume:         false,
    support_host:        'https://www.tradingview.com',
    studies:             ['STD;RSI', 'STD;MACD'],
  };
}

// ── Main component ────────────────────────────────────────────────────────────

function TradingChart({ symbol, height, priceSource }) {
  const containerRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const { isDark } = useThemeContext();

  const tvSymbol = toTVSymbol(symbol);

  const buildWidget = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'tradingview-widget-container__widget';
    wrapper.style.cssText = 'height:100%;width:100%;';
    container.appendChild(wrapper);

    const script  = document.createElement('script');
    script.type   = 'text/javascript';
    script.src    = SCRIPT_SRC;
    script.async  = true;
    script.textContent = JSON.stringify(buildWidgetConfig(tvSymbol, isDark));

    console.log('[TradingChart] Widget config:', { inputSymbol: symbol, tvSymbol, theme: isDark ? 'dark' : 'light' });

    container.appendChild(script);
  }, [tvSymbol, symbol, isDark]);

  useEffect(() => {
    buildWidget();
    return () => { if (containerRef.current) containerRef.current.innerHTML = ''; };
  }, [buildWidget, fullscreen, isDark]);

  // Source badge config
  const isLive   = priceSource && priceSource.startsWith('LIVE');
  const badgeLabel = priceSource === 'LIVE_TWELVE'  ? '🟢 TwelveData'
                   : priceSource === 'LIVE_FINNHUB' ? '🟢 Finnhub'
                   : priceSource === 'SIM'          ? '🟡 SIM'
                   : '● NSE';
  const badgeColor = isLive ? 'var(--green)' : priceSource === 'SIM' ? 'var(--amber)' : 'var(--green)';
  const badgeBg    = isLive ? 'color-mix(in srgb, var(--green) 8%, transparent)' : priceSource === 'SIM' ? 'color-mix(in srgb, var(--amber) 8%, transparent)' : 'color-mix(in srgb, var(--green) 8%, transparent)';
  const badgeBdr   = isLive ? 'color-mix(in srgb, var(--green) 20%, transparent)' : priceSource === 'SIM' ? 'color-mix(in srgb, var(--amber) 20%, transparent)' : 'color-mix(in srgb, var(--green) 20%, transparent)';

  const wrapStyle = fullscreen ? {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: '#060a12', display: 'flex', flexDirection: 'column',
  } : {
    borderRadius: 12, overflow: 'hidden',
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    display: 'flex', flexDirection: 'column',
  };

  return (
    <div style={wrapStyle}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        background: fullscreen ? (isDark ? '#0a0f1e' : '#f0f4fa') : undefined,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'color-mix(in srgb, var(--cyan) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--cyan) 15%, transparent)',
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
          {/* Price source badge */}
          <div style={{
            padding: '3px 9px', borderRadius: 6,
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
            background: badgeBg, border: `1px solid ${badgeBdr}`, color: badgeColor,
          }}>
            {badgeLabel}
          </div>

          <button
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border)',
              background: fullscreen ? 'color-mix(in srgb, var(--cyan) 10%, transparent)' : 'var(--bg-elevated)',
              color: fullscreen ? 'var(--cyan)' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-bright)'; e.currentTarget.style.color = 'var(--cyan)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = fullscreen ? 'var(--cyan)' : 'var(--text-secondary)'; }}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Widget */}
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{
          width: '100%',
          height: fullscreen ? 'calc(100vh - 52px)' : undefined,
          minHeight: fullscreen ? undefined : 360,
          flex: fullscreen ? 1 : undefined,
        }}
      />
    </div>
  );
}

export default memo(TradingChart);
