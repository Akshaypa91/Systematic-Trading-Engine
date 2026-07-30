// src/components/SignalCard.jsx — v2
// Terminal-grade signal card: side accent, confidence ring, indicator grid
// (RSI / MA trend / SMA / Bollinger), optional levels (entry/target/SL/R:R
// — rendered only when the engine provides them), strategy component tags,
// and one-tap BUY/SELL. Data flow and trade wiring unchanged from v1.
import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity, Clock3 } from 'lucide-react';
import { simAPI, manualTradeAPI } from '../services/api';
import { price as fmtPrice } from '../utils/format';

function ConfRing({ value = 0 }) {
  const pct = Math.round(value * 100);
  const r = 22, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct > 65 ? 'var(--green)' : pct > 35 ? 'var(--cyan)' : 'var(--amber)';
  return (
    <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }} role="img" aria-label={`Confidence ${pct}%`}>
      <svg width="56" height="56" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--border)" strokeWidth="3.5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.4s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color }}>{pct}%</span>
        <span className="mono" style={{ fontSize: 7.5, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>CONF</span>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="sig-stat">
      <span className="k">{label}</span>
      <span className="v" style={color ? { color } : undefined}>{value ?? '—'}</span>
    </div>
  );
}

export default function SignalCard({ signal: s, flash = false, onTrade }) {
  const [trading, setTrading] = useState(null);
  const [tradeMsg, setTradeMsg] = useState(null);
  if (!s) return null;

  const sig = s.signal || 'HOLD';

  // How fresh is the price this card is built on? The old code had two states,
  // LIVE and SIM, and SIM meant "invented". There is no invented state any more;
  // the question now is only how delayed the real price is, which the trader
  // needs to see because it changes what the signal is worth.
  const SOURCE_BADGE = {
    LIVE:       { text: 'LIVE',       color: 'var(--green)', title: 'Real-time broker quote' },
    STALE:      { text: 'STALE',      color: 'var(--amber)', title: 'Last real quote — the feed has not updated recently' },
    LAST_CLOSE: { text: 'LAST CLOSE', color: 'var(--amber)', title: 'Previous session close — no live feed connected' },
  };
  const badge = SOURCE_BADGE[String(s.source || '').toUpperCase()]
    || { text: 'NO DATA', color: 'var(--text-muted)', title: 'No usable price for this symbol' };
  const live = badge.text === 'LIVE';

  const rsi = s.rsi != null ? Number(s.rsi) : null;
  const sma20 = s.sma20 != null ? Number(s.sma20) : null;
  const sma50 = s.sma50 != null ? Number(s.sma50) : null;
  const bbU = s.bbUpper != null ? Number(s.bbUpper) : null;
  const bbL = s.bbLower != null ? Number(s.bbLower) : null;

  const sigColor = sig === 'BUY' ? 'var(--green)' : sig === 'SELL' ? 'var(--red)' : 'var(--amber)';
  const Icon = sig === 'BUY' ? TrendingUp : sig === 'SELL' ? TrendingDown : Minus;

  const rsiColor = rsi != null ? (rsi < 30 ? 'var(--green)' : rsi > 70 ? 'var(--red)' : 'var(--text-primary)') : undefined;
  const bull = sma20 != null && sma50 != null ? sma20 > sma50 : null;
  const maColor = bull == null ? undefined : bull ? 'var(--green)' : 'var(--red)';

  // Optional engine-provided levels — shown only when real values exist.
  const entry = s.entry ?? s.entryPrice ?? null;
  const target = s.target ?? s.targetPrice ?? s.takeProfit ?? null;
  const stop = s.stopLoss ?? s.stoploss ?? s.sl ?? null;
  const rr = s.riskReward ?? s.rr ??
    (entry != null && target != null && stop != null && Number(entry) !== Number(stop)
      ? Math.abs((target - entry) / (entry - stop))
      : null);

  async function handleTrade(side) {
    if (trading) return;
    setTrading(side);
    setTradeMsg(null);
    try {
      await simAPI.start(1000000).catch(() => {});  // init portfolio if not done
      await manualTradeAPI.place(s.symbol, side, 10);
      setTradeMsg({ ok: true, text: `${side} ×10 @ ${fmtPrice(s.currentPrice)}` });
      onTrade?.({ symbol: s.symbol, side, price: s.currentPrice, qty: 10, signal: sig });
    } catch (err) {
      setTradeMsg({ ok: false, text: err.response?.data?.error || 'Order failed' });
    } finally {
      setTrading(null);
      setTimeout(() => setTradeMsg(null), 3500);
    }
  }

  return (
    <div
      className={`sig-card${flash ? ' trade-flash' : ''}`}
      data-side={sig}
      style={{ '--sig-accent': sig === 'HOLD' ? 'transparent' : sigColor }}
    >
      <div className="sig-body">
        {/* Header: symbol + price | confidence */}
        <div className="ui-between" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="ui-hstack" style={{ gap: 8 }}>
              <span className="sym" style={{ fontSize: 14.5 }}>{s.symbol}</span>
              <span
                className="ws-pill"
                title={badge.title}
                style={{
                  fontSize: 8.5, padding: '2px 7px', whiteSpace: 'nowrap',
                  background: `color-mix(in srgb, ${badge.color} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${badge.color} 30%, transparent)`,
                  color: badge.color,
                }}
              >
                {badge.text}
              </span>
            </div>
            <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {s.currentPrice != null ? fmtPrice(s.currentPrice) : '—'}
            </div>
          </div>
          <ConfRing value={s.confidence} />
        </div>

        {/* Signal ribbon */}
        <div className="ui-between">
          <span
            className="ui-hstack mono"
            style={{
              gap: 6, padding: '6px 12px', borderRadius: 8,
              background: `color-mix(in srgb, ${sigColor} 9%, transparent)`,
              border: `1px solid color-mix(in srgb, ${sigColor} 24%, transparent)`,
              color: sigColor, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em',
            }}
          >
            <Icon size={13} aria-hidden="true" /> {sig}
          </span>
          {s.score != null && (
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>
              SCORE <b style={{ color: Number(s.score) >= 0 ? 'var(--green)' : 'var(--red)' }}>{s.score > 0 ? '+' : ''}{s.score}</b>
            </span>
          )}
        </div>

        {/* Indicator grid */}
        <div className="sig-grid">
          <Stat label="RSI (14)" value={rsi != null ? rsi.toFixed(1) : null} color={rsiColor} />
          <Stat label="MA Trend" value={bull == null ? null : bull ? '▲ Bullish' : '▼ Bearish'} color={maColor} />
          <Stat label="SMA 20" value={sma20 != null ? fmtPrice(sma20) : null} />
          <Stat label="SMA 50" value={sma50 != null ? fmtPrice(sma50) : null} />
          <Stat label="BB Upper" value={bbU != null ? fmtPrice(bbU) : null} color="var(--red)" />
          <Stat label="BB Lower" value={bbL != null ? fmtPrice(bbL) : null} color="var(--green)" />
          {entry != null && <Stat label="Entry" value={fmtPrice(entry)} />}
          {target != null && <Stat label="Target" value={fmtPrice(target)} color="var(--green)" />}
          {stop != null && <Stat label="Stoploss" value={fmtPrice(stop)} color="var(--red)" />}
          {rr != null && Number.isFinite(Number(rr)) && <Stat label="R : R" value={`1 : ${Number(rr).toFixed(2)}`} color="var(--cyan)" />}
          {s.volume != null && <Stat label="Volume" value={Number(s.volume).toLocaleString('en-IN')} />}
        </div>

        {/* Strategy component tags */}
        {s.components && Object.keys(s.components).length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {Object.entries(s.components).map(([k, v]) => (
              <span key={k} className="mono" style={{
                fontSize: 8.5, padding: '2px 6px', borderRadius: 4,
                background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)',
                letterSpacing: '0.04em',
              }}>
                {k.toUpperCase()} {String(v)}
              </span>
            ))}
          </div>
        )}

        {/* One-tap trade */}
        <div style={{ display: 'flex', gap: 6 }}>
          {['BUY', 'SELL'].map((side) => {
            const SideIcon = side === 'BUY' ? TrendingUp : TrendingDown;
            return (
              <button
                key={side}
                className="sig-side-btn"
                data-side={side}
                data-hot={sig === side}
                onClick={() => handleTrade(side)}
                // No price, no order. Placing a trade against a missing quote
                // used to be possible because a fabricated one was always there.
                disabled={!!trading || s.currentPrice == null}
                title={s.currentPrice == null ? 'No price available for this symbol' : undefined}
                aria-label={`${side} 10 shares of ${s.symbol}`}
              >
                {trading === side ? <Activity size={11} className="animate-spin" /> : <SideIcon size={11} />}
                {side}
              </button>
            );
          })}
        </div>

        {/* Trade feedback */}
        {tradeMsg && (
          <div
            className="mono fade-in"
            role="status"
            style={{
              fontSize: 10, textAlign: 'center', padding: '5px 8px', borderRadius: 6,
              background: `color-mix(in srgb, ${tradeMsg.ok ? 'var(--green)' : 'var(--red)'} 8%, transparent)`,
              border: `1px solid color-mix(in srgb, ${tradeMsg.ok ? 'var(--green)' : 'var(--red)'} 22%, transparent)`,
              color: tradeMsg.ok ? 'var(--green)' : 'var(--red)',
            }}
          >
            {tradeMsg.text}
          </div>
        )}

        {/* Timestamp */}
        {s.timestamp && (
          <div className="ui-hstack mono" style={{ gap: 4, fontSize: 9.5, color: 'var(--text-muted)', justifyContent: 'flex-end' }}>
            <Clock3 size={9} aria-hidden="true" />
            {new Date(s.timestamp).toLocaleTimeString('en-IN', { hour12: false })}
          </div>
        )}
      </div>
    </div>
  );
}
