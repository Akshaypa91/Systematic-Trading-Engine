// src/context/TradingModeContext.jsx — Phase 1 (Live Trading)
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for PAPER / LIVE trading mode + broker connection.
// Lets the mode selector live in the global Navbar (always visible) while the
// Trade page, Broker Status Card, and LIVE banner all read/write the same state.
//
// Safety invariant: LIVE can never be active while the broker is disconnected.
// If the broker drops, mode is forced back to PAPER.
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { liveAPI } from '../services/api';
import { useAuth } from './AuthContext';

const TradingModeContext = createContext(null);

export function TradingModeProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [mode,         setMode]         = useState('PAPER');
  const [brokerLinked, setBrokerLinked] = useState(false);
  const [loading,      setLoading]      = useState(true);
  const modeRef = useRef('PAPER');
  modeRef.current = mode;

  // Initial + periodic sync with the server's notion of mode/broker.
  const sync = useCallback(async () => {
    if (!isAuthenticated) { setLoading(false); return; }
    try {
      const res = await liveAPI.status();
      setMode(res.data?.tradingMode || 'PAPER');
      setBrokerLinked(!!res.data?.brokerLinked);
    } catch { /* keep last known */ }
    finally { setLoading(false); }
  }, [isAuthenticated]);

  useEffect(() => { sync(); }, [sync]);

  // Persist a mode change to the server.
  const changeMode = useCallback((next) => {
    if (next === 'LIVE' && !brokerLinked) return;   // guard: no LIVE without broker
    setMode(next);
    liveAPI.setMode(next).catch(() => {});
  }, [brokerLinked]);

  // Broker connection reported by BrokerStatusCard. If it drops while LIVE,
  // force PAPER and tell the server.
  const reportBroker = useCallback((connected) => {
    setBrokerLinked(connected);
    if (!connected && modeRef.current === 'LIVE') {
      setMode('PAPER');
      liveAPI.setMode('PAPER').catch(() => {});
    }
  }, []);

  return (
    <TradingModeContext.Provider value={{ mode, brokerLinked, loading, changeMode, reportBroker, refresh: sync }}>
      {children}
    </TradingModeContext.Provider>
  );
}

export function useTradingMode() {
  const ctx = useContext(TradingModeContext);
  if (!ctx) throw new Error('useTradingMode must be used within TradingModeProvider');
  return ctx;
}
