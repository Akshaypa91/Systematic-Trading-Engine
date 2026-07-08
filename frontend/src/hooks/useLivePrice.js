// src/hooks/useLivePrice.js
// Subscribe a component to continuous live-price ticks for a single symbol.
//
// On mount (and whenever `symbol` changes) it subscribes over the shared
// WebSocket; on unmount / symbol-change it unsubscribes. The backend polls the
// symbol every 5s and pushes { type:'PRICE', ... } messages, which WSContext
// stores in its `prices` map. This hook simply reads the live entry back out.
//
// Symbol changes are handled automatically by the effect cleanup: the previous
// symbol is unsubscribed (freeing the server-side poll if nobody else watches
// it) before the new one is subscribed.
import { useEffect } from 'react';
import { useWS } from '../context/WSContext';

export default function useLivePrice(symbol) {
  const { prices, subscribe, unsubscribe, status } = useWS();

  const sym = symbol ? String(symbol).toUpperCase().trim() : '';

  useEffect(() => {
    if (!sym) return undefined;
    subscribe([sym]);
    return () => unsubscribe([sym]);
  }, [sym, subscribe, unsubscribe]);

  const live = sym ? prices[sym] : null;

  return {
    price:  live?.price ?? null,
    source: live?.source ?? null,
    ts:     live?.ts ?? null,
    isLive: !!live,
    wsStatus: status,
  };
}
