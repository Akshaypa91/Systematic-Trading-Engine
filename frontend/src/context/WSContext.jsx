// src/context/WSContext.jsx
// Provides a single persistent WebSocket connection to the entire app.
// Components subscribe via useWS() and get live data without polling.
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WSContext = createContext(null);

const WS_URL     = (import.meta.env.VITE_WS_URL  || 'ws://localhost:3000') + '/ws';
const RECONNECT_MS = 3000;
const MAX_TRADE_HISTORY = 100;

export function WSProvider({ children }) {
  const [status,    setStatus]    = useState('connecting'); // connecting | connected | disconnected
  const [signals,   setSignals]   = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [trades,    setTrades]    = useState([]);           // most-recent trade events (ring buffer)
  const [lastTick,  setLastTick]  = useState(null);         // ISO timestamp of last SIM_TICK
  const [newTrade,  setNewTrade]  = useState(null);         // latest trade for flash animation

  const wsRef      = useRef(null);
  const timerRef   = useRef(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus('connected');
      clearTimeout(timerRef.current);
    };

    ws.onmessage = (evt) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(evt.data);

        if (msg.type === 'SIM_TICK') {
          const { signals: sigs, portfolio: port } = msg.data || {};
          if (sigs)  setSignals(sigs);
          if (port)  setPortfolio(port);
          setLastTick(new Date(msg.ts).toISOString());
        }

        if (msg.type === 'SIM_TRADE') {
          const trade = msg.data;
          setNewTrade(trade);
          setTrades(prev => {
            const next = [trade, ...prev];
            return next.slice(0, MAX_TRADE_HISTORY);
          });
        }

        // Legacy live signal engine messages
        if (msg.type === 'LIVE_SIGNAL') {
          setSignals(prev => {
            const idx = prev.findIndex(s => s.symbol === msg.data.symbol);
            if (idx === -1) return [msg.data, ...prev];
            const next = [...prev];
            next[idx] = msg.data;
            return next;
          });
        }

      } catch (_) {}
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus('disconnected');
      timerRef.current = setTimeout(connect, RECONNECT_MS);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    wsRef.current?.close();
    setTimeout(connect, 100);
  }, [connect]);

  return (
    <WSContext.Provider value={{ status, signals, portfolio, trades, lastTick, newTrade, reconnect }}>
      {children}
    </WSContext.Provider>
  );
}

export function useWS() {
  const ctx = useContext(WSContext);
  if (!ctx) throw new Error('useWS must be used inside WSProvider');
  return ctx;
}
