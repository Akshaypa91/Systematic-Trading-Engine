// src/components/CapitalSetup.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Capital initialization panel.
// Shown when portfolio.initialized === false.
// Calls POST /api/sim/start with user-defined capital.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from 'react';
import { Wallet, Play, AlertCircle, ChevronRight, Sparkles } from 'lucide-react';
import { simAPI } from '../services/api';

// ── Preset capital options ────────────────────────────────────────────────────
const PRESETS = [
  { label: '₹10K',   value: 10000   },
  { label: '₹50K',   value: 50000   },
  { label: '₹1L',    value: 100000  },
  { label: '₹5L',    value: 500000  },
  { label: '₹10L',   value: 1000000 },
  { label: '₹50L',   value: 5000000 },
];

const MIN_CAPITAL = 1000;
const MAX_CAPITAL = 1_000_000_000;

function fmtINR(n) {
  if (!n || isNaN(n)) return '';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function parseRaw(str) {
  // Strip commas so user can paste "1,00,000"
  return Number(String(str).replace(/,/g, ''));
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CapitalSetup({ onInitialized }) {
  const [raw,     setRaw]     = useState('');       // raw string in input
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const inputRef              = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const parsed  = parseRaw(raw);
  const valid   = Number.isFinite(parsed) && parsed >= MIN_CAPITAL && parsed <= MAX_CAPITAL;

  function handlePreset(value) {
    setRaw(String(value));
    setError('');
    inputRef.current?.focus();
  }

  function handleChange(e) {
    // Allow only digits and commas
    const cleaned = e.target.value.replace(/[^\d,]/g, '');
    setRaw(cleaned);
    setError('');
  }

  async function handleStart() {
    if (!valid || busy) return;

    const cap = parseRaw(raw);

    if (cap < MIN_CAPITAL) {
      setError(`Minimum capital is ₹${fmtINR(MIN_CAPITAL)}`);
      return;
    }
    if (cap > MAX_CAPITAL) {
      setError(`Maximum capital is ₹${fmtINR(MAX_CAPITAL)}`);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await simAPI.start(cap);
      const portfolio = res.data?.portfolio ?? null;
      onInitialized(portfolio);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to initialize portfolio');
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleStart();
  }

  // Visual feedback on capital size
  const capLabel = parsed >= 1_000_000
    ? `₹${(parsed / 100000).toFixed(1)}L`
    : parsed >= 1000
    ? `₹${(parsed / 1000).toFixed(1)}K`
    : parsed > 0
    ? `₹${fmtINR(parsed)}`
    : null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '48px 24px',
      animation: 'fadeUp 0.4s ease-out both',
    }}>

      {/* Icon */}
      <div style={{
        width: 64, height: 64, borderRadius: 20, marginBottom: 24,
        background: 'linear-gradient(135deg, rgba(0,212,255,0.12), rgba(0,229,160,0.08))',
        border: '1px solid rgba(0,212,255,0.20)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 32px rgba(0,212,255,0.08)',
        position: 'relative',
      }}>
        <Wallet size={26} style={{ color: 'var(--cyan)' }} />
        <div style={{
          position: 'absolute', top: -4, right: -4,
          width: 18, height: 18, borderRadius: '50%',
          background: 'rgba(0,229,160,0.15)',
          border: '1px solid rgba(0,229,160,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Sparkles size={9} style={{ color: 'var(--green)' }} />
        </div>
      </div>

      {/* Heading */}
      <h2 style={{
        fontSize: 22, fontWeight: 700, color: 'var(--text-primary)',
        marginBottom: 8, textAlign: 'center',
      }}>
        Set Your Starting Capital
      </h2>
      <p className="font-mono" style={{
        fontSize: 12, color: 'var(--text-muted)',
        marginBottom: 32, textAlign: 'center', lineHeight: 1.7,
        maxWidth: 360,
      }}>
        Enter your starting capital to initialize the portfolio.<br />
        All trades will be tracked against this amount.
      </p>

      {/* Card */}
      <div className="card" style={{
        width: '100%', maxWidth: 420,
        padding: 28, display: 'flex', flexDirection: 'column', gap: 20,
      }}>

        {/* Preset chips */}
        <div>
          <div className="section-label" style={{ marginBottom: 10 }}>Quick Select</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {PRESETS.map(p => {
              const active = parseRaw(raw) === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handlePreset(p.value)}
                  className="font-mono"
                  style={{
                    padding: '8px 0', borderRadius: 8,
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    transition: 'all 0.15s',
                    background: active
                      ? 'rgba(0,212,255,0.13)'
                      : 'var(--bg-elevated)',
                    border: `1px solid ${active ? 'rgba(0,212,255,0.35)' : 'var(--border)'}`,
                    color: active ? 'var(--cyan)' : 'var(--text-secondary)',
                    boxShadow: active ? '0 0 10px rgba(0,212,255,0.10)' : 'none',
                  }}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom input */}
        <div>
          <div className="section-label" style={{ marginBottom: 8 }}>
            Or Enter Custom Amount
          </div>
          <div style={{ position: 'relative' }}>
            {/* ₹ prefix */}
            <span className="font-mono" style={{
              position: 'absolute', left: 14, top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 15, fontWeight: 600,
              color: raw ? 'var(--cyan)' : 'var(--text-dim)',
              pointerEvents: 'none', lineHeight: 1,
              transition: 'color 0.15s',
            }}>₹</span>

            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={raw}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="1,00,000"
              className="input font-mono"
              style={{
                paddingLeft: 30,
                paddingRight: capLabel ? 80 : 14,
                fontSize: 16, fontWeight: 600, letterSpacing: '0.02em',
              }}
            />

            {/* Live label */}
            {capLabel && (
              <span className="font-mono" style={{
                position: 'absolute', right: 12, top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 11, fontWeight: 600, color: 'var(--green)',
                background: 'rgba(0,229,160,0.08)',
                border: '1px solid rgba(0,229,160,0.20)',
                padding: '2px 7px', borderRadius: 5,
                pointerEvents: 'none',
              }}>
                {capLabel}
              </span>
            )}
          </div>

          {/* Validation hint */}
          <p className="font-mono" style={{
            fontSize: 10, color: 'var(--text-dim)', marginTop: 6,
          }}>
            Min ₹{fmtINR(MIN_CAPITAL)} · Max ₹{fmtINR(MAX_CAPITAL)}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(255,77,106,0.07)',
            border: '1px solid rgba(255,77,106,0.22)',
            animation: 'fadeUp 0.2s ease-out',
          }}>
            <AlertCircle size={13} style={{ color: 'var(--red)', flexShrink: 0 }} />
            <p className="font-mono" style={{ fontSize: 11, color: 'var(--red)' }}>
              {error}
            </p>
          </div>
        )}

        {/* Start button */}
        <button
          onClick={handleStart}
          disabled={!valid || busy}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 8,
            padding: '13px 0', borderRadius: 10,
            cursor: valid && !busy ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.07em', transition: 'all 0.18s',
            opacity: valid && !busy ? 1 : 0.4,
            background: valid && !busy
              ? 'linear-gradient(135deg, rgba(0,212,255,0.18), rgba(0,229,160,0.12))'
              : 'var(--bg-elevated)',
            color: valid && !busy ? 'var(--cyan)' : 'var(--text-muted)',
            border: `1px solid ${valid && !busy ? 'rgba(0,212,255,0.35)' : 'var(--border)'}`,
            boxShadow: valid && !busy ? '0 0 20px rgba(0,212,255,0.10)' : 'none',
          }}>
          {busy ? (
            <>
              <div style={{
                width: 13, height: 13, borderRadius: '50%',
                border: '2px solid rgba(0,212,255,0.3)',
                borderTopColor: 'var(--cyan)',
                animation: 'spin 0.8s linear infinite',
              }} />
              Initializing…
            </>
          ) : (
            <>
              <Play size={13} />
              Start Trading
              {capLabel && (
                <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: 2 }}>
                  · {capLabel}
                </span>
              )}
              <ChevronRight size={13} style={{ marginLeft: -4 }} />
            </>
          )}
        </button>
      </div>

      {/* Footer note */}
      <p className="font-mono" style={{
        fontSize: 10, color: 'var(--text-dim)',
        marginTop: 20, textAlign: 'center', lineHeight: 1.7,
      }}>
        Capital is stored in memory · Survives page refresh during session<br />
        Use Reset to start over with the same capital
      </p>
    </div>
  );
}
