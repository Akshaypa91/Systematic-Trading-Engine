// src/hooks/useSystemStatus.js
// Polls real backend/DB/market-data/trading-mode health for the status bar.
// No fabricated data — every field here traces back to a real endpoint:
//   GET /health            → backend + DB status, version, uptime, DB region
//   GET /api/data/health   → per-provider market data health (Upstox/NSE/TwelveData/Finnhub) + cache
//   GET /api/data/market-status → NSE open/closed/pre-open (server-computed IST)
//   GET /api/live/status   → trading mode (PAPER/LIVE), broker link (auth only)
import { useState, useEffect, useRef, useCallback } from 'react';
import { marketAPI, liveAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/api\/?$/, '');
// Slower status-bar polling to stay well under the backend rate limit (the
// status bar is mounted app-wide, so these fire on every page). Health/market
// data change slowly; 30–60s is plenty for a status indicator.
const HEALTH_INTERVAL = 30000;
const MARKET_INTERVAL = 60000;
const TRADING_INTERVAL = 30000;

export function useSystemStatus() {
  const { isAuthenticated } = useAuth();

  const [backend, setBackend] = useState({ ok: null, dbOk: null, version: null, uptime: null, region: null, latencyMs: null });
  const [marketData, setMarketData] = useState({ ok: null, upstox: null, nse: null, twelvedata: null, finnhub: null, cache: null });
  const [marketStatus, setMarketStatus] = useState({ status: null, isOpen: null, isPreOpen: null });
  const [trading, setTrading] = useState({ mode: 'PAPER', brokerLinked: false, broker: null, killSwitch: false });
  const [netInfo, setNetInfo] = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const pollHealth = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await fetch(`${API_ROOT}/health`);
      const latencyMs = Math.round(performance.now() - t0);
      const data = await res.json();
      if (!mountedRef.current) return;
      setBackend({
        ok: res.ok,
        dbOk: data.db === 'connected',
        version: data.version || null,
        uptime: data.uptime || null,
        region: data.dbRegion || null,
        latencyMs,
      });
    } catch {
      if (!mountedRef.current) return;
      setBackend(prev => ({ ...prev, ok: false, dbOk: false, latencyMs: null }));
    }
  }, []);

  const pollMarketData = useCallback(async () => {
    try {
      const res = await marketAPI.getHealth();
      if (!mountedRef.current) return;
      const { api, cache } = res.data;
      setMarketData({
        ok: !!api?.overall,
        upstox: !!api?.upstox?.ok,
        nse: !!api?.nse?.ok,
        twelvedata: !!api?.twelvedata?.ok,
        finnhub: !!api?.finnhub?.ok,
        cache,
      });
    } catch {
      if (!mountedRef.current) return;
      setMarketData(prev => ({ ...prev, ok: false }));
    }
  }, []);

  const pollMarketStatus = useCallback(async () => {
    try {
      const res = await marketAPI.getMarketStatus();
      if (!mountedRef.current) return;
      const d = res.data?.data || {};
      setMarketStatus({ status: d.marketStatus || null, isOpen: !!d.isOpen, isPreOpen: !!d.isPreOpen });
    } catch {
      /* leave last-known state on a transient error */
    }
  }, []);

  const pollTrading = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await liveAPI.status();
      if (!mountedRef.current) return;
      setTrading({
        mode: res.data?.tradingMode || 'PAPER',
        brokerLinked: !!res.data?.brokerLinked,
        broker: res.data?.broker || null,
        killSwitch: !!res.data?.killSwitch,
      });
    } catch {
      /* leave last-known state — don't flip trading mode to a guess on a transient error */
    }
  }, [isAuthenticated]);

  useEffect(() => {
    pollHealth();
    pollMarketData();
    pollMarketStatus();
    pollTrading();

    const h = setInterval(pollHealth, HEALTH_INTERVAL);
    const m = setInterval(pollMarketData, MARKET_INTERVAL);
    const s = setInterval(pollMarketStatus, MARKET_INTERVAL);
    const t = setInterval(pollTrading, TRADING_INTERVAL);
    return () => { clearInterval(h); clearInterval(m); clearInterval(s); clearInterval(t); };
  }, [pollHealth, pollMarketData, pollMarketStatus, pollTrading]);

  // Network Information API — Chrome/Edge/Android only, feature-detected.
  // Not fabricated for unsupported browsers: netInfo stays null and the UI hides it.
  useEffect(() => {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return;
    const update = () => setNetInfo({ effectiveType: conn.effectiveType, downlink: conn.downlink });
    update();
    conn.addEventListener?.('change', update);
    return () => conn.removeEventListener?.('change', update);
  }, []);

  return { backend, marketData, marketStatus, trading, netInfo };
}
