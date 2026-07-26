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

// Real-money safety interlock. The user must explicitly "arm" real-money order
// placement once per browser session (type CONFIRM). We keep this in
// sessionStorage — NOT localStorage — so it resets every session: closing the
// tab or reopening the app requires re-arming. This is deliberately a
// per-session gate, independent of the PAPER/LIVE toggle.
const ARM_KEY = 'systra.realMoneyArmed';
function readArmed() {
  try { return sessionStorage.getItem(ARM_KEY) === '1'; } catch { return false; }
}

export function TradingModeProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [mode,           setMode]           = useState('PAPER');
  const [brokerLinked,   setBrokerLinked]   = useState(false);
  const [loading,        setLoading]        = useState(true);
  const [realMoneyArmed, setRealMoneyArmed] = useState(readArmed);
  const modeRef = useRef('PAPER');
  modeRef.current = mode;

  // Arm / disarm the real-money interlock, mirrored to sessionStorage.
  const armRealMoney = useCallback(() => {
    try { sessionStorage.setItem(ARM_KEY, '1'); } catch { /* noop */ }
    setRealMoneyArmed(true);
  }, []);
  const disarmRealMoney = useCallback(() => {
    try { sessionStorage.removeItem(ARM_KEY); } catch { /* noop */ }
    setRealMoneyArmed(false);
  }, []);

  // Initial + periodic sync with the server's notion of mode/broker.
  const sync = useCallback(async () => {
    if (!isAuthenticated) { setLoading(false); return; }
    try {
      const res = await liveAPI.status();
      // Only adopt a mode the server actually reported. Defaulting a missing
      // field to PAPER would silently demote a LIVE session on a partial response.
      const serverMode = res.data?.tradingMode;
      if (serverMode === 'LIVE' || serverMode === 'PAPER') setMode(serverMode);
      if (res.data?.brokerLinked !== undefined) setBrokerLinked(!!res.data.brokerLinked);
    } catch { /* keep last known */ }
    finally { setLoading(false); }
  }, [isAuthenticated]);

  useEffect(() => { sync(); }, [sync]);

  // Persist a mode change to the server. Leaving LIVE disarms the interlock so
  // the user must re-confirm CONFIRM before the next real-money session.
  const changeMode = useCallback((next) => {
    if (next === 'LIVE' && !brokerLinked) return;   // guard: no LIVE without broker
    if (next !== 'LIVE') disarmRealMoney();
    setMode(next);
    liveAPI.setMode(next).catch(() => {});
  }, [brokerLinked, disarmRealMoney]);

  // Broker connection reported by BrokerStatusCard.
  //   true  → linked
  //   false → DEFINITELY not linked (server said so): if LIVE, force PAPER
  //   null  → UNKNOWN (status fetch failed: cold start, 429, network blip).
  //           Must be a no-op — treating "unknown" as "disconnected" silently
  //           demoted LIVE→PAPER (and persisted it) on any transient error.
  const reportBroker = useCallback((connected) => {
    if (connected == null) return;            // unknown — keep last known state
    setBrokerLinked(connected);
    if (!connected) {
      disarmRealMoney();
      if (modeRef.current === 'LIVE') {
        setMode('PAPER');
        liveAPI.setMode('PAPER').catch(() => {});
      }
    }
  }, [disarmRealMoney]);

  return (
    <TradingModeContext.Provider value={{
      mode, brokerLinked, loading, changeMode, reportBroker, refresh: sync,
      realMoneyArmed, armRealMoney, disarmRealMoney,
    }}>
      {children}
    </TradingModeContext.Provider>
  );
}

export function useTradingMode() {
  const ctx = useContext(TradingModeContext);
  if (!ctx) throw new Error('useTradingMode must be used within TradingModeProvider');
  return ctx;
}
