// src/context/WSContext.jsx — HARDENED
// Single persistent WebSocket connection for the whole app.
// Never crashes on malformed messages.
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WSContext = createContext(null);

const WS_BASE      = (import.meta.env.VITE_WS_URL || 'ws://localhost:3000') + '/ws';
const RECONNECT_MS = 3000;
const MAX_TRADES   = 100;
const CLOSE_BAD_TOKEN = 4001;

function getWsUrl() {
  const token = localStorage.getItem('token');
  return token ? `${WS_BASE}?token=${encodeURIComponent(token)}` : WS_BASE;
}

// Lightweight debug logging — enable with localStorage.setItem('WS_DEBUG','1')
function dbg(...args) {
  try { if (localStorage.getItem('WS_DEBUG')) console.debug('[WS]', ...args); } catch { /* ignore */ }
}

// Safe number helper
const n = (v, fb = 0) => (isFinite(Number(v)) ? Number(v) : fb);

// Normalise portfolio from either sim or legacy shape
function normalisePortfolio(raw) {
  if (!raw) return null;
  return {
    equity:           n(raw.equity ?? raw.capital ?? raw.totalValue),
    capital:          n(raw.capital ?? raw.equity ?? raw.totalValue),
    initialCapital:   n(raw.initialCapital ?? raw.initial_capital, 1000000),
    totalReturn:      n(raw.totalReturn ?? raw.totalReturnPct ?? raw.total_return_pct),
    totalPnl:         n(raw.totalPnl ?? raw.totalPnL ?? raw.realized_pnl),
    openPnl:          n(raw.openPnl ?? raw.unrealizedPnL ?? raw.open_pnl),
    openPositionCount:n(raw.openPositionCount ?? (raw.openPositions ? Object.keys(raw.openPositions).length : 0)),
    openPositions:    raw.openPositions ?? raw.positions ?? {},
    initialized:      raw.initialized !== false,
    source:           raw.source ?? 'SIM',
  };
}

export function WSProvider({ children }) {
  const [status,    setStatus]    = useState('connecting');
  const [signals,   setSignals]   = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [trades,    setTrades]    = useState([]);
  const [lastTick,  setLastTick]  = useState(null);
  const [newTrade,  setNewTrade]  = useState(null);
  const [prices,    setPrices]    = useState({});  // symbol → { price, source, ts }

  const wsRef      = useRef(null);
  const timerRef   = useRef(null);
  const mountedRef = useRef(true);
  // symbol → subscriber count. Reference-counted so multiple components can
  // subscribe to the same symbol without duplicate server subscriptions, and
  // so we can re-send every active subscription after a reconnect.
  const subsRef    = useRef(new Map());

  // Send a JSON action if the socket is open. Returns true if sent.
  const sendJSON = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); return true; } catch { /* ignore */ }
    }
    return false;
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(getWsUrl());
    } catch (e) {
      console.warn('[WS] Failed to create WebSocket:', e.message);
      timerRef.current = setTimeout(connect, RECONNECT_MS);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus('connected');
      clearTimeout(timerRef.current);
      dbg('connected');
      // Re-subscribe to every active symbol. Critical after a reconnect —
      // otherwise prices silently go stale once the socket drops and recovers.
      const symbols = [...subsRef.current.keys()];
      if (symbols.length) {
        dbg('resubscribe', symbols);
        try { ws.send(JSON.stringify({ action: 'SUBSCRIBE', symbols })); } catch { /* ignore */ }
      }
    };

    ws.onmessage = (evt) => {
      if (!mountedRef.current) return;
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      try {
        switch (msg.type) {
          case 'TOKEN_INVALID': {
            // Server rejected our JWT (wrong secret / expired signature)
            // Clear it and reconnect once without a token — don't keep looping
            console.warn('[WS] Server: token invalid — clearing and reconnecting anonymously');
            localStorage.removeItem('token');
            // Close current connection and let onclose trigger a clean reconnect
            ws.close();
            break;
          }
          case 'SIM_TICK': {
            const { signals: sigs, portfolio: port } = msg.data || {};
            if (Array.isArray(sigs)) setSignals(sigs);
            if (port) setPortfolio(normalisePortfolio(port));
            setLastTick(msg.ts ? new Date(msg.ts).toISOString() : new Date().toISOString());
            break;
          }
          case 'SIM_TRADE': {
            const trade = msg.data;
            if (!trade) break;
            setNewTrade(trade);
            setTrades(prev => [trade, ...prev].slice(0, MAX_TRADES));
            break;
          }
          case 'LIVE_SIGNAL': {
            const sig = msg.data;
            if (!sig?.symbol) break;
            setSignals(prev => {
              const idx = prev.findIndex(s => s.symbol === sig.symbol);
              if (idx === -1) return [sig, ...prev];
              const next = [...prev]; next[idx] = sig; return next;
            });
            break;
          }
          case 'PRICE': {
            const { symbol, price, source, ts } = msg;
            if (symbol && isFinite(Number(price))) {
              dbg('tick', symbol, price, source);
              setPrices(prev => ({ ...prev, [symbol]: { price: Number(price), source, ts: ts || new Date().toISOString() } }));
            }
            break;
          }
          default: break;
        }
      } catch (e) {
        console.warn('[WS] Handler error:', e.message);
      }
    };

    ws.onclose = (_evt) => {
      if (!mountedRef.current) return;
      setStatus('disconnected');
      timerRef.current = setTimeout(connect, RECONNECT_MS);
    };

    ws.onerror = () => {
      // onclose fires after onerror — let it handle reconnect
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;  // prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    setTimeout(connect, 100);
  }, [connect]);

  // ── Subscription API (reference-counted) ──────────────────────────────────
  // Components call subscribe([sym]) on mount / symbol-change and
  // unsubscribe([sym]) on cleanup. The server starts a 5s poll per symbol on
  // first subscribe and stops it when the last subscriber leaves.
  const subscribe = useCallback((symbols = []) => {
    const map = subsRef.current;
    const toSend = [];
    for (const raw of symbols) {
      const sym = String(raw || '').toUpperCase().trim();
      if (!sym) continue;
      const count = map.get(sym) || 0;
      map.set(sym, count + 1);
      if (count === 0) toSend.push(sym);   // first subscriber → tell the server
    }
    if (toSend.length) {
      dbg('subscribe', toSend);
      sendJSON({ action: 'SUBSCRIBE', symbols: toSend });
    }
  }, [sendJSON]);

  const unsubscribe = useCallback((symbols = []) => {
    const map = subsRef.current;
    const toSend = [];
    for (const raw of symbols) {
      const sym = String(raw || '').toUpperCase().trim();
      if (!sym) continue;
      const count = map.get(sym) || 0;
      if (count <= 1) {
        map.delete(sym);
        toSend.push(sym);                  // last subscriber left → free the poll
      } else {
        map.set(sym, count - 1);
      }
    }
    if (toSend.length) {
      dbg('unsubscribe', toSend);
      sendJSON({ action: 'UNSUBSCRIBE', symbols: toSend });
      // Drop cached prices for symbols nobody is watching anymore.
      setPrices(prev => {
        const next = { ...prev };
        for (const sym of toSend) delete next[sym];
        return next;
      });
    }
  }, [sendJSON]);

  return (
    <WSContext.Provider value={{ status, signals, portfolio, trades, lastTick, newTrade, prices, reconnect, subscribe, unsubscribe }}>
      {children}
    </WSContext.Provider>
  );
}

export function useWS() {
  const ctx = useContext(WSContext);
  if (!ctx) throw new Error('useWS must be inside WSProvider');
  return ctx;
}
