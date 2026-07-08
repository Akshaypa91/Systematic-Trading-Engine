import { Wallet, TrendingUp, TrendingDown, Layers, Activity } from 'lucide-react';
import { Sparkline } from './ui';
import { inrCompact, inr, pct, colorOf, toneOf } from '../utils/format';

/**
 * PortfolioHero — the top-of-dashboard portfolio summary strip.
 * Reads the normalized portfolio object from WSContext / tradeAPI.getPortfolio.
 * All figures derive from real data; when uninitialized it shows a graceful
 * empty affordance instead of fake numbers.
 */
function Delta({ value, suffix = '%' }) {
  const tone = toneOf(value);
  const Icon = tone === 'neg' ? TrendingDown : TrendingUp;
  return (
    <span className={`hero-delta ${tone}`}>
      {tone !== 'flat' && <Icon size={13} aria-hidden="true" />}
      {suffix === '%' ? pct(value) : inr(value, { sign: true })}
    </span>
  );
}

export default function PortfolioHero({ portfolio, spark = [] }) {
  const p = portfolio || {};
  const equity = p.equity ?? p.capital ?? 0;
  const initial = p.initialCapital || 1000000;
  const totalReturn = p.totalReturn ?? ((equity - initial) / (initial || 1)) * 100;
  const todayPnl = p.openPnl ?? 0;
  const overallPnl = p.totalPnl ?? equity - initial;
  const positions = p.openPositionCount ?? (p.openPositions ? Object.keys(p.openPositions).length : 0);

  const initialized = p.initialized !== false && (equity > 0 || positions > 0);

  return (
    <div className="hero-strip dash-section">
      <div className="hero-cell primary">
        <span className="hero-label"><Wallet size={12} /> Portfolio Equity</span>
        <span className="hero-value">{initialized ? inr(equity) : '—'}</span>
        {initialized ? (
          <div className="ui-hstack" style={{ gap: 8 }}>
            <Delta value={totalReturn} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              vs {inrCompact(initial)} initial
            </span>
          </div>
        ) : (
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Set capital to begin</span>
        )}
        {spark.length > 1 && <div className="hero-spark"><Sparkline data={spark} width={96} height={30} /></div>}
      </div>

      <div className="hero-cell">
        <span className="hero-label"><Activity size={12} /> Today's P&amp;L</span>
        <span className="hero-value md tnum" style={{ color: colorOf(todayPnl) }}>
          {initialized ? inr(todayPnl, { sign: true }) : '—'}
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Unrealized · open positions</span>
      </div>

      <div className="hero-cell">
        <span className="hero-label"><TrendingUp size={12} /> Overall P&amp;L</span>
        <span className="hero-value md tnum" style={{ color: colorOf(overallPnl) }}>
          {initialized ? inr(overallPnl, { sign: true }) : '—'}
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Realized since inception</span>
      </div>

      <div className="hero-cell">
        <span className="hero-label"><Layers size={12} /> Open Positions</span>
        <span className="hero-value md tnum">{initialized ? positions : '—'}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {p.source ? `${p.source} engine` : 'Live tracking'}
        </span>
      </div>
    </div>
  );
}
