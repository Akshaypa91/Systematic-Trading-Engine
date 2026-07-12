// src/pages/SwingStrategy.jsx
// "Fresh 52wk Breakout" swing-trade setup scanner — strategy by Akshay Pagare.
// Pulls real daily candles from /api/data/candles and evaluates the rule set
// in utils/swingStrategy.js (same logic as the TradingView script). Frontend
// only — no backend changes.
import { useState, useCallback, useRef, useEffect } from 'react';
import AppShell from '../components/AppShell';
import PriceChart from '../components/PriceChart';
import Toast from '../components/Toast';
import { marketAPI, swingAPI } from '../services/api';
import { evaluateSwing } from '../utils/swingStrategy';
import {
  Rocket, Search, CheckCircle2, XCircle, RefreshCw, Target,
  ShieldAlert, TrendingUp, Clock3, BadgeCheck, Radar, Square,
} from 'lucide-react';
import { Card, CardHeader, Chip, Field, Input, Button, PageHeader, Badge } from '../components/ui';

const QUICK = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'TATAMOTORS', 'BAJFINANCE'];

// Scan universe — NIFTY-50 constituents (edit freely; & symbols omitted as
// they need URL-encoding the candles route doesn't do).
const UNIVERSE = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'ITC', 'LT', 'AXISBANK',
  'SBIN', 'BHARTIARTL', 'KOTAKBANK', 'ASIANPAINT', 'HINDUNILVR', 'BAJFINANCE',
  'MARUTI', 'TITAN', 'SUNPHARMA', 'ULTRACEMCO', 'NTPC', 'POWERGRID',
  'TATASTEEL', 'TATAMOTORS', 'WIPRO', 'HCLTECH', 'TECHM', 'ADANIENT',
  'ADANIPORTS', 'JSWSTEEL', 'NESTLEIND', 'GRASIM', 'CIPLA', 'DRREDDY',
  'APOLLOHOSP', 'BAJAJFINSV', 'BRITANNIA', 'COALINDIA', 'EICHERMOT',
  'HEROMOTOCO', 'HINDALCO', 'INDUSINDBK', 'ONGC', 'SBILIFE', 'HDFCLIFE',
  'TATACONSUM', 'BPCL', 'SHRIRAMFIN', 'BAJAJ-AUTO', 'DIVISLAB', 'UPL', 'TRENT',
];
const money = (v, d = 2) => v == null || !Number.isFinite(v) ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })}`;

const VERDICT = {
  BREAKOUT: { label: 'FRESH 52WK BREAKOUT', color: 'var(--green)', sub: 'All conditions met — setup is live' },
  WATCHING: { label: 'WATCHING',            color: 'var(--amber)', sub: 'Trend intact — waiting for a fresh breakout' },
  NO_SETUP: { label: 'NO SETUP',            color: 'var(--red)',   sub: 'Core trend conditions not met' },
};

const fmtDate = (d) => d ? new Date(String(d).slice(0, 10)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/* Signal row — symbol + date on top, full trade levels below. Used for both
   today's scan hits and the persisted history. */
function SignalRow({ symbol, date, entry, sl, slPct, t1, t2, rr1, onClick }) {
  const lv = (label, val, color) => (
    <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
      {label} <b style={{ color, fontWeight: 700 }}>{money(val)}</b>
    </span>
  );
  return (
    <button
      className="mini-tile"
      onClick={onClick}
      style={{
        flexDirection: 'column', alignItems: 'stretch', gap: 7,
        cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit',
        borderColor: 'color-mix(in srgb, var(--green) 30%, var(--border))',
      }}
    >
      <span className="ui-between ui-wrap" style={{ gap: 8, rowGap: 4 }}>
        <span className="ui-hstack ui-wrap" style={{ gap: 8, rowGap: 4, minWidth: 0 }}>
          <span className="sym" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{symbol}</span>
          <Badge tone="buy">FRESH BREAKOUT</Badge>
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>{fmtDate(date)}</span>
      </span>
      <span className="ui-hstack ui-wrap" style={{ gap: 12, rowGap: 4 }}>
        {lv('Entry', entry, 'var(--cyan)')}
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          SL <b style={{ color: 'var(--red)', fontWeight: 700 }}>{money(sl)}</b> (−{Number(slPct).toFixed(1)}%)
        </span>
        {lv('T1', t1, 'var(--green)')}
        {lv('T2', t2, 'var(--green)')}
        <span className="mono" style={{ fontSize: 10.5, color: Number(rr1) >= 1.5 ? 'var(--green)' : 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          R:R {Number(rr1).toFixed(2)}:1
        </span>
      </span>
    </button>
  );
}

function LevelRow({ label, value, sub, color }) {
  return (
    <div className="ui-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</span>
        {sub && <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>{sub}</span>}
      </span>
    </div>
  );
}

export default function SwingStrategy() {
  const [symbol, setSymbol] = useState('');
  const [input, setInput] = useState('');
  const [capital, setCapital] = useState(200000);
  const [riskPct, setRiskPct] = useState(1.0);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Universe scan state
  const [scan, setScan] = useState(null); // { running, done, total, hits: [], at }
  const cancelRef = useRef(false);

  // Persisted signal history (server, deduped per day+symbol)
  const [history, setHistory] = useState([]);
  const loadHistory = useCallback(() => {
    swingAPI.history(200)
      .then(r => setHistory(r.data?.signals || []))
      .catch(() => {}); // older backend — hide the section
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Preferred path: server-side scan (covers every backend-supported symbol,
  // survives page reloads, one shared cache). Falls back to the in-browser
  // sweep below when the backend doesn't have /api/swing yet.
  const runServerScan = useCallback(async () => {
    cancelRef.current = false;
    const started = await swingAPI.run();
    if (started.data?.error) {
      setToast({ msg: started.data.error, type: 'error' });
      return;
    }
    setScan({ running: true, done: 0, total: 0, hits: [], at: null, server: true });
    for (;;) {
      if (cancelRef.current) { setScan(s => s && { ...s, running: false }); return; }
      await new Promise(res => setTimeout(res, 2500));
      const r = await swingAPI.state();
      const st = r.data;
      const hits = (st.hits || []).map(h => ({ ...h }));
      if (st.running) {
        setScan({ running: true, done: st.done, total: st.total || 1, hits, at: null, server: true });
      } else {
        setScan({ running: false, done: st.total, total: st.total || 1, hits, at: st.finishedAt ? new Date(st.finishedAt) : new Date(), server: true, universe: st.universe });
        setToast({ msg: hits.length ? `${hits.length} fresh breakout${hits.length > 1 ? 's' : ''} found` : 'No fresh breakouts — all rules strict, no signal today', type: hits.length ? 'success' : 'info' });
        loadHistory(); // scan results are persisted server-side
        return;
      }
    }
  }, [loadHistory]);

  const runClientScan = useCallback(async () => {
    cancelRef.current = false;
    setScan({ running: true, done: 0, total: UNIVERSE.length, hits: [], at: null });
    const hits = [];
    for (const sym of UNIVERSE) {
      if (cancelRef.current) break;
      try {
        const r = await marketAPI.getCandles(sym, { interval: 'day', days: 420 });
        const rep = evaluateSwing(r.data?.candles || [], { capital, riskPct });
        // STRICT: only report when every rule passes — no partial tiers.
        if (rep.ok && rep.verdict === 'BREAKOUT') {
          hits.push({
            symbol: sym,
            verdict: 'BREAKOUT',
            signalDate: new Date().toISOString().slice(0, 10),
            close: rep.close,
            entry: rep.levels.entry,
            sl: rep.levels.sl,
            slPct: rep.levels.slPct,
            t1: rep.levels.t1,
            t2: rep.levels.t2,
            rr1: rep.levels.rr1,
          });
        }
      } catch { /* symbol failed — skip, keep scanning */ }
      setScan(s => s && ({ ...s, done: s.done + 1, hits: [...hits] }));
      await new Promise(res => setTimeout(res, 120)); // be gentle on the API
    }
    hits.sort((a, b) => b.rr1 - a.rr1);
    setScan({ running: false, done: UNIVERSE.length, total: UNIVERSE.length, hits, at: new Date() });
    setToast({ msg: hits.length ? `${hits.length} fresh breakout${hits.length > 1 ? 's' : ''} found` : 'No fresh breakouts — all rules strict, no signal today', type: hits.length ? 'success' : 'info' });
  }, [capital, riskPct]);

  // Dispatcher: server scan first, in-browser sweep as fallback.
  const runScan = useCallback(async () => {
    try {
      await runServerScan();
    } catch (e) {
      if (e.response?.status === 404) runClientScan();
      else setToast({ msg: e.response?.data?.error || 'Scan failed — is the backend running?', type: 'error' });
    }
  }, [runServerScan, runClientScan]);

  const analyze = useCallback(async (symRaw, cap = capital, risk = riskPct) => {
    const sym = String(symRaw || '').toUpperCase().trim();
    if (!sym || sym.includes(' ')) { setToast({ msg: 'Enter a valid NSE symbol', type: 'error' }); return; }
    setLoading(true); setReport(null); setSymbol(sym);
    try {
      const r = await marketAPI.getCandles(sym, { interval: 'day', days: 420 });
      const candles = r.data?.candles || [];
      const rep = evaluateSwing(candles, { capital: cap, riskPct: risk });
      if (!rep.ok) {
        setToast({ msg: rep.reason, type: 'error' });
      } else {
        setReport(rep);
        const v = VERDICT[rep.verdict];
        setToast({ msg: `${sym}: ${v.label}`, type: rep.verdict === 'BREAKOUT' ? 'success' : 'info' });
      }
    } catch (e) {
      setToast({ msg: e.response?.data?.error || 'Could not load candles — connect Upstox for chart data', type: 'error' });
    } finally { setLoading(false); }
  }, [capital, riskPct]);

  const v = report ? VERDICT[report.verdict] : null;
  const L = report?.levels;

  return (
    <AppShell>
      <main className="page-content" style={{ maxWidth: 1280 }}>
        <PageHeader
          title="Swing Setup"
          subtitle="Fresh 52-week breakout system · NSE daily timeframe"
          action={
            <span className="ws-pill" style={{
              background: 'color-mix(in srgb, var(--purple) 10%, transparent)',
              borderColor: 'color-mix(in srgb, var(--purple) 32%, transparent)',
              color: 'var(--purple)', fontWeight: 700, gap: 6,
            }}>
              <BadgeCheck size={12} /> Strategy by Akshay Pagare
            </span>
          }
        />

        {/* Strategy pitch strip */}
        <Card className="dash-section" style={{ borderColor: 'color-mix(in srgb, var(--purple) 18%, var(--border))' }}>
          <div className="ui-hstack ui-wrap" style={{ gap: 16 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, flexShrink: 0,
              background: 'color-mix(in srgb, var(--purple) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--purple) 26%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Rocket size={19} style={{ color: 'var(--purple)' }} />
            </div>
            <div className="ui-grow" style={{ minWidth: 240 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                Fresh 52wk Breakout <span style={{ color: 'var(--purple)' }}>· Investors Way</span>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.6 }}>
                Buy strength the day it proves itself: NIFTY-500 stocks in a rising 50/200-DMA uptrend,
                closing above their 52-week high for the first time on ≥2× volume. Risk 1% per trade,
                book half at 1.5×ATR, half at 3×ATR, trail the rest — out in 15 sessions if it stalls.
              </p>
            </div>
            <div className="ui-hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
              {['Trend-following', 'Volume-confirmed', '1% risk', 'R:R ≥ 1.5'].map(t => (
                <span key={t} className="mono" style={{
                  fontSize: 10, padding: '3px 9px', borderRadius: 99,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                }}>{t}</span>
              ))}
            </div>
          </div>
        </Card>

        {/* Scanner controls */}
        <Card className="dash-section">
          <CardHeader title="Check a symbol" sub="Daily candles · needs ~1 year of history" />
          <form
            onSubmit={(e) => { e.preventDefault(); analyze(input); }}
            className="ui-hstack ui-wrap"
            style={{ gap: 12, alignItems: 'flex-end' }}
          >
            <Field label="NSE Symbol" style={{ flex: '2 1 180px' }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <Input value={input} onChange={e => setInput(e.target.value.toUpperCase())} placeholder="e.g. TATAMOTORS" style={{ paddingLeft: 32 }} />
              </div>
            </Field>
            <Field label="Capital (₹)" style={{ flex: '1 1 120px' }}>
              <Input type="number" min="10000" value={capital} onChange={e => setCapital(+e.target.value)} />
            </Field>
            <Field label="Risk %" style={{ flex: '0 1 90px' }}>
              <Input type="number" step="0.25" min="0.25" max="5" value={riskPct} onChange={e => setRiskPct(+e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" icon={Rocket} loading={loading} style={{ height: 38 }}>
              {loading ? 'Scanning…' : 'Evaluate'}
            </Button>
          </form>
          <div className="ui-hstack ui-wrap" style={{ gap: 6, marginTop: 12 }}>
            <span className="section-label" style={{ alignSelf: 'center' }}>Quick:</span>
            {QUICK.map(s => (
              <Chip key={s} active={symbol === s} onClick={() => { setInput(s); analyze(s); }}>{s}</Chip>
            ))}
          </div>
        </Card>

        {/* ── Universe scan: today's signals ── */}
        <Card className="dash-section">
          <CardHeader
            title="Today's swing signals"
            sub="All NSE-listed equities · strict — a stock appears only when every rule passes"
            action={
              scan?.running ? (
                <Button variant="red" size="sm" icon={Square} onClick={() => { cancelRef.current = true; }}>
                  Stop
                </Button>
              ) : (
                <Button variant="primary" size="sm" icon={Radar} onClick={runScan}>
                  {scan ? 'Re-scan' : 'Scan for signals'}
                </Button>
              )
            }
          />

          {scan?.running && (
            <div style={{ marginBottom: 14 }}>
              <div className="ui-between" style={{ marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                  Scanning… {scan.done}/{scan.total}
                </span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                  {scan.hits.length} candidate{scan.hits.length !== 1 ? 's' : ''} so far
                </span>
              </div>
              <div className="meter">
                <span style={{ width: `${(scan.done / scan.total) * 100}%`, background: 'var(--cyan)' }} />
              </div>
            </div>
          )}

          {!scan && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Scans every NSE-listed equity through the full rule set and lists only fresh
              52-week breakouts. Requires a connected Upstox session. Full-market scan takes a few minutes.
            </p>
          )}

          {scan && !scan.running && scan.hits.length === 0 && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              No stock passed all rules today. Fresh 52-week breakouts on 2× volume are rare —
              that selectivity is the strategy. Re-scan after the next market close.
            </p>
          )}

          {scan?.hits.length > 0 && (
            <div className="ui-vstack" style={{ gap: 6 }}>
              {scan.hits.map(h => (
                <SignalRow
                  key={h.symbol}
                  symbol={h.symbol}
                  date={h.signalDate}
                  entry={h.entry} sl={h.sl} slPct={h.slPct} t1={h.t1} t2={h.t2} rr1={h.rr1}
                  onClick={() => { setInput(h.symbol); analyze(h.symbol); }}
                />
              ))}
              {scan.at && (
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)', textAlign: 'right', marginTop: 4 }}>
                  Scanned {scan.universe || scan.total} stocks · {scan.at.toLocaleTimeString('en-IN', { hour12: false })} · tap a row for the full trade plan
                </span>
              )}
            </div>
          )}
        </Card>

        {/* ── Signal history (persisted server-side, deduped per day) ── */}
        {history.length > 0 && (
          <Card className="dash-section">
            <CardHeader
              title="Signal history"
              sub={`${history.length} signal${history.length !== 1 ? 's' : ''} recorded · every scan saves new breakouts with their date`}
              action={<Clock3 size={13} style={{ color: 'var(--text-muted)' }} />}
            />
            <div className="ui-vstack" style={{ gap: 14, maxHeight: 560, overflowY: 'auto' }} >
              {Object.entries(
                history.reduce((g, s) => {
                  const d = String(s.signal_date).slice(0, 10);
                  (g[d] = g[d] || []).push(s);
                  return g;
                }, {})
              ).map(([date, rows]) => (
                <div key={date} className="ui-vstack" style={{ gap: 6, flexShrink: 0 }}>
                  <div className="section-label" style={{ paddingBottom: 2, borderBottom: '1px solid var(--border)' }}>
                    {fmtDate(date)} · {rows.length} signal{rows.length !== 1 ? 's' : ''}
                  </div>
                  {rows.map(s => (
                    <SignalRow
                      key={`${date}-${s.symbol}`}
                      symbol={s.symbol}
                      date={date}
                      entry={s.entry} sl={s.sl} slPct={s.sl_pct} t1={s.t1} t2={s.t2} rr1={s.rr1}
                      onClick={() => { setInput(s.symbol); analyze(s.symbol); }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Results */}
        {report && (
          <>
            <div className="dash-grid-2 dash-section" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
              {/* Checklist */}
              <Card className="fade-up">
                <CardHeader
                  title={`${symbol} — condition checklist`}
                  sub={`Close ${money(report.close)} · ATR(14) ${money(report.atr)} (${(report.atrPct * 100).toFixed(2)}%)`}
                  action={
                    <span className="mono" style={{
                      fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 8,
                      background: `color-mix(in srgb, ${v.color} 10%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${v.color} 32%, transparent)`,
                      color: v.color, whiteSpace: 'nowrap',
                    }}>{v.label}</span>
                  }
                />
                <p className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 12 }}>{v.sub}</p>
                <div className="ui-vstack" style={{ gap: 6 }}>
                  {report.checks.map(c => (
                    <div key={c.key} className="mini-tile" style={{ gap: 10 }}>
                      <span className="ui-hstack" style={{ gap: 9, minWidth: 0 }}>
                        {c.pass
                          ? <CheckCircle2 size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
                          : <XCircle size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />}
                        <span style={{ fontSize: 12.5, color: c.pass ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{c.label}</span>
                      </span>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{c.detail}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Trade plan */}
              <Card className="fade-up stagger-1">
                <CardHeader title="Trade plan" sub={`₹${Number(L.risk).toLocaleString('en-IN')} at risk (${riskPct}%)`} action={<Target size={13} style={{ color: 'var(--text-muted)' }} />} />
                <LevelRow label="Entry"            value={money(L.entry)} color="var(--cyan)" />
                <LevelRow label="Stop loss"        value={money(L.sl)} sub={`−${L.slPct.toFixed(1)}%`} color="var(--red)" />
                <LevelRow label="T1 · sell 50%"    value={money(L.t1)} sub={`R:R ${L.rr1.toFixed(2)}:1`} color="var(--green)" />
                <LevelRow label="T2 · sell 50%"    value={money(L.t2)} sub={`R:R ${L.rr2.toFixed(2)}:1`} color="var(--green)" />
                <LevelRow label="Quantity"         value={`${L.qty} shares`} sub={`${L.qtyHalf} + ${L.qty - L.qtyHalf}`} color="var(--purple)" />
                <LevelRow
                  label="SL width"
                  value={`${L.slPct.toFixed(1)}% ${L.slPct <= 8 ? 'Good' : L.slPct <= 12 ? 'OK' : 'Wide — skip'}`}
                  color={L.slPct <= 8 ? 'var(--green)' : L.slPct <= 12 ? 'var(--amber)' : 'var(--red)'}
                />
                <div className="ui-vstack" style={{ gap: 8, marginTop: 14 }}>
                  <div className="ui-hstack" style={{ gap: 8 }}>
                    <TrendingUp size={12} style={{ color: report.exits.trailExit ? 'var(--red)' : 'var(--text-muted)', flexShrink: 0 }} />
                    <span className="mono" style={{ fontSize: 10.5, color: report.exits.trailExit ? 'var(--red)' : 'var(--text-muted)' }}>
                      Trail exit: 2 closes below 10-EMA ({money(report.exits.ema10)}){report.exits.trailExit ? ' — TRIGGERED' : ''}
                    </span>
                  </div>
                  <div className="ui-hstack" style={{ gap: 8 }}>
                    <Clock3 size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Time stop: exit after 15 sessions without progress</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* Chart with the levels in context */}
            <div className="dash-section">
              <PriceChart symbol={symbol} height={340} />
            </div>
          </>
        )}

        {/* Disclaimer */}
        <div className="ui-hstack" style={{ gap: 8, marginTop: 8 }}>
          <ShieldAlert size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <p className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            Educational tool — rule-based screening by Akshay Pagare, not investment advice. Markets carry risk; do your own research.
          </p>
        </div>
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
          <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </AppShell>
  );
}
