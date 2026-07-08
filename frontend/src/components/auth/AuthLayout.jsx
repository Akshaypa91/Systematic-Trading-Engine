// src/components/auth/AuthLayout.jsx
// Shared split-screen shell for Login / Signup / Forgot / Reset.
// Left 60%: branding panel — animated candlestick chart, equity line, feature
// highlights, and a clearly-labelled simulated ticker strip. Right 40%: glass
// card. Mobile: branding collapses into a compact hero above the card.
// Purely presentational — no auth logic lives here.
import { useMemo } from 'react';
import { useThemeContext } from '../../context/ThemeContext';
import { Sun, Moon, Zap, LineChart, Shield, PieChart, Radio, FlaskConical } from 'lucide-react';

/* ── Brand logo (single source for all auth pages) ─────────────────────────── */
export function SystraLogo({ size = 40 }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="color-mix(in srgb, var(--cyan) 12%, transparent)" stroke="color-mix(in srgb, var(--cyan) 30%, transparent)" strokeWidth="1" />
      <polyline points="7,29 12,20 17,24 22,14 27,18 33,11" stroke="var(--cyan)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="27" cy="11" r="2.2" fill="var(--cyan)" />
      <line x1="7" y1="32" x2="33" y2="32" stroke="color-mix(in srgb, var(--cyan) 25%, transparent)" strokeWidth="1" />
      <circle cx="12" cy="20" r="1.5" fill="color-mix(in srgb, var(--cyan) 50%, transparent)" />
      <circle cx="17" cy="24" r="1.5" fill="color-mix(in srgb, var(--cyan) 50%, transparent)" />
      <circle cx="22" cy="14" r="1.5" fill="color-mix(in srgb, var(--cyan) 50%, transparent)" />
    </svg>
  );
}

/* ── Deterministic sample series (decorative, labelled SIM) ────────────────── */
function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function useCandles(count = 30) {
  return useMemo(() => {
    const rand = seededRand(42);
    const candles = [];
    let price = 52;
    for (let i = 0; i < count; i++) {
      const drift = (rand() - 0.44) * 9;
      const open = price;
      const close = Math.max(18, Math.min(92, price + drift));
      const hi = Math.max(open, close) + rand() * 4;
      const lo = Math.min(open, close) - rand() * 4;
      candles.push({ open, close, hi, lo });
      price = close;
    }
    return candles;
  }, [count]);
}

const TICKS = [
  ['RELIANCE', '2,914.35', +0.84], ['TCS', '4,102.10', -0.32], ['INFY', '1,689.55', +1.12],
  ['HDFCBANK', '1,742.80', +0.45], ['ICICIBANK', '1,258.40', -0.18], ['SBIN', '862.25', +0.67],
  ['AXISBANK', '1,196.00', +0.23], ['WIPRO', '512.70', -0.55], ['NIFTY 50', '24,857.30', +0.41],
];

function CandleChart() {
  const candles = useCandles(30);
  const W = 560, H = 170, cw = W / candles.length;
  const y = (v) => H - (v / 100) * H;
  const linePts = candles.map((c, i) => `${(i + 0.5) * cw},${y((c.open + c.close) / 2) - 26}`).join(' ');
  return (
    <div className="auth-candles" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax meet">
        {candles.map((c, i) => {
          const up = c.close >= c.open;
          const color = up ? 'var(--green)' : 'var(--red)';
          const bodyTop = y(Math.max(c.open, c.close));
          const bodyH = Math.max(3, Math.abs(y(c.open) - y(c.close)));
          return (
            <g key={i} className="auth-candle" style={{ '--i': i }}>
              <line x1={(i + 0.5) * cw} x2={(i + 0.5) * cw} y1={y(c.hi)} y2={y(c.lo)} stroke={color} strokeWidth="1" opacity="0.45" />
              <rect x={i * cw + cw * 0.22} y={bodyTop} width={cw * 0.56} height={bodyH} rx="1.5" fill={color} opacity="0.55" />
            </g>
          );
        })}
        <polyline
          className="auth-eqline"
          points={linePts}
          fill="none"
          stroke="var(--cyan)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
      </svg>
    </div>
  );
}

function Ticker() {
  const items = [...TICKS, ...TICKS]; // duplicated for a seamless loop
  return (
    <div className="auth-ticker-wrap" aria-hidden="true">
      <span className="auth-ticker-tag">SIM FEED</span>
      <div className="auth-ticker">
        {items.map(([sym, px, chg], i) => (
          <span key={i} className="auth-tick">
            <span className="ts">{sym}</span>
            <span className="tp">₹{px}</span>
            <span className="tc" style={{ color: chg >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: Zap,          accent: 'var(--cyan)',   title: 'Real-Time Trading',   sub: 'Live NSE quotes over WebSocket' },
  { icon: FlaskConical, accent: 'var(--purple)', title: 'Backtesting',         sub: 'Validate strategies on years of data' },
  { icon: Shield,       accent: 'var(--green)',  title: 'Paper Trading',       sub: 'Practice risk-free before going live' },
  { icon: PieChart,     accent: 'var(--amber)',  title: 'Portfolio Analytics', sub: 'PnL, drawdown and allocation insight' },
  { icon: Radio,        accent: 'var(--red)',    title: 'AI Signals',          sub: 'RSI · MA cross · Bollinger · composite score' },
];

function BrandPanel() {
  return (
    <section className="auth-brand" aria-label="About SYSTRA">
      <div className="auth-orb" style={{ width: 340, height: 340, top: '-90px', left: '-70px', background: 'color-mix(in srgb, var(--cyan) 16%, transparent)' }} />
      <div className="auth-orb" style={{ width: 280, height: 280, bottom: '90px', right: '-60px', background: 'color-mix(in srgb, var(--green) 12%, transparent)', animationDelay: '-6s' }} />

      <div className="auth-brand-top">
        <div className="auth-brand-logo">
          <SystraLogo size={42} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.09em', color: 'var(--text-primary)' }}>SYSTRA</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Systematic Trading Engine</div>
          </div>
        </div>

        <h1>Trade NSE with <em>signals, backtests</em> and discipline.</h1>
        <p className="auth-brand-sub">
          A systematic trading workspace — screen the market, validate strategies against
          history, paper-trade them live and track every rupee of P&amp;L.
        </p>

        <div className="auth-feats">
          {FEATURES.map(({ icon: Icon, accent, title, sub }, i) => (
            <div key={title} className="auth-feat" style={{ '--i': i, '--feat-accent': accent }}>
              <span className="auth-feat-icon"><Icon size={14} aria-hidden="true" /></span>
              <span>
                <b>{title}</b>
                <span>{sub}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <CandleChart />
        <Ticker />
      </div>
    </section>
  );
}

/* ── Layout shell ──────────────────────────────────────────────────────────── */
export default function AuthLayout({ children, footer }) {
  const { isDark, toggleTheme } = useThemeContext();
  return (
    <div className="auth-shell">
      <button
        className="auth-theme-btn"
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      <BrandPanel />

      <main className="auth-pane">
        {/* Mobile hero (replaces the branding panel below 1024px) */}
        <div className="auth-hero">
          <SystraLogo size={44} />
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.09em', color: 'var(--text-primary)' }}>SYSTRA</div>
          <p>Signals · Backtesting · Paper Trading</p>
        </div>

        {children}

        <div className="auth-foot">
          {footer || <>SYSTRA · NSE India · {new Date().getFullYear()}</>}
        </div>
      </main>
    </div>
  );
}
