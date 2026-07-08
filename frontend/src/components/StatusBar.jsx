// src/components/StatusBar.jsx
// Slim professional status bar — desktop only (≥1024px). Replaces the old
// bottom nav on desktop entirely; BottomNav.jsx now handles mobile alone.
// Every indicator here is backed by a real endpoint/context — see
// hooks/useSystemStatus.js for the data sources.
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Server, Database, Radio, LineChart, Shield, Zap, Clock3,
  Gauge, Wifi, Bell, Keyboard,
} from 'lucide-react';
import { useWS } from '../context/WSContext';
import { useAuth } from '../context/AuthContext';
import { useSystemStatus } from '../hooks/useSystemStatus';

function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function StatusItem({ icon: Icon, dot, label, value, tooltip, as: As = 'button', ...rest }) {
  return (
    <div className="status-item">
      <As className="status-btn" {...rest}>
        {dot !== undefined && <span className={`status-dot ${dot === null ? 'unknown' : dot === 'warn' ? 'warn' : dot ? 'ok' : 'bad'}`} />}
        <Icon size={11.5} strokeWidth={2} />
        <span className="status-btn-label">{label}</span>
        {value != null && <span className="status-btn-label" style={{ color: 'var(--text-secondary)' }}>{value}</span>}
      </As>
      {tooltip && (
        <div className="status-tooltip" role="tooltip">
          {tooltip}
        </div>
      )}
    </div>
  );
}

function TooltipRow({ label, value }) {
  return (
    <div className="status-tooltip-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function StatusBar({ onOpenShortcuts }) {
  const { status: wsStatus, trades, reconnect } = useWS();
  const { isAuthenticated } = useAuth();
  const { backend, marketData, marketStatus, trading, netInfo } = useSystemStatus();

  const now = useLiveClock();
  const [notifOpen, setNotifOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const notifRef = useRef(null);

  const unseenCount = Math.max(0, trades.length - seenCount);

  useEffect(() => {
    function onClickOutside(e) {
      if (notifOpen && notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [notifOpen]);

  function toggleNotif() {
    setNotifOpen(o => {
      if (!o) setSeenCount(trades.length);
      return !o;
    });
  }

  const wsDot = wsStatus === 'connected' ? true : wsStatus === 'connecting' ? 'warn' : false;
  const marketLabel = marketStatus.status || '—';
  const marketDot = marketStatus.isOpen ? true : marketStatus.isPreOpen ? 'warn' : false;

  return (
    <footer className="status-bar" role="contentinfo" aria-label="System status">
      {/* ── Left: connectivity + mode ───────────────────────────────────── */}
      <div className="status-bar-section left">
        <StatusItem
          icon={Server} dot={backend.ok} label="API"
          tooltip={
            <>
              <div className="status-tooltip-title">Backend API</div>
              <TooltipRow label="Status"  value={backend.ok == null ? 'Checking…' : backend.ok ? 'Connected' : 'Unreachable'} />
              <TooltipRow label="Latency" value={backend.latencyMs != null ? `${backend.latencyMs} ms` : '—'} />
              <TooltipRow label="Uptime"  value={backend.uptime || '—'} />
            </>
          }
        />
        <StatusItem
          icon={Database} dot={backend.dbOk} label="DB"
          tooltip={
            <>
              <div className="status-tooltip-title">Database</div>
              <TooltipRow label="Status"   value={backend.dbOk == null ? 'Checking…' : backend.dbOk ? 'Connected' : 'Disconnected'} />
              <TooltipRow label="Latency"  value={backend.latencyMs != null ? `${backend.latencyMs} ms` : '—'} />
              <TooltipRow label="Provider" value="TiDB Cloud" />
              {backend.region && <TooltipRow label="Region" value={backend.region} />}
            </>
          }
        />
        <StatusItem
          icon={Radio} dot={wsDot} label="WS"
          as="button" onClick={wsStatus !== 'connected' ? reconnect : undefined}
          tooltip={
            <>
              <div className="status-tooltip-title">WebSocket Feed</div>
              <TooltipRow label="Status" value={wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connecting…' : 'Disconnected — click to retry'} />
            </>
          }
        />
        <StatusItem
          icon={LineChart} dot={marketData.ok} label="Data"
          tooltip={
            <>
              <div className="status-tooltip-title">Market Data Providers</div>
              <TooltipRow label="Upstox"     value={marketData.upstox ? 'Live' : 'Down'} />
              <TooltipRow label="NSE"        value={marketData.nse ? 'Live' : 'Down'} />
              <TooltipRow label="TwelveData" value={marketData.twelvedata ? 'Live' : 'Down'} />
              <TooltipRow label="Finnhub"    value={marketData.finnhub ? 'Live' : 'Down'} />
              {marketData.cache && <TooltipRow label="Cache" value="Healthy" />}
            </>
          }
        />
        {isAuthenticated && (
          <StatusItem
            icon={trading.mode === 'LIVE' ? Zap : Shield}
            dot={trading.mode === 'LIVE' ? (trading.killSwitch ? 'warn' : true) : true}
            label={trading.mode}
            as={Link} to="/live"
            tooltip={
              <>
                <div className="status-tooltip-title">Trading Mode</div>
                <TooltipRow label="Mode"   value={trading.mode} />
                <TooltipRow label="Broker" value={trading.brokerLinked ? (trading.broker || 'Linked') : 'Not linked'} />
                {trading.mode === 'LIVE' && <TooltipRow label="Kill switch" value={trading.killSwitch ? 'ENGAGED' : 'Off'} />}
              </>
            }
          />
        )}
      </div>

      <div className="status-bar-divider" />

      {/* ── Center: market clock + latency + version ────────────────────── */}
      <div className="status-bar-section center">
        <StatusItem
          icon={Clock3} dot={undefined} label={now.toLocaleTimeString('en-IN', { hour12: false })}
          as="span" className="status-btn static"
          tooltip={
            <>
              <div className="status-tooltip-title">Server Time</div>
              <TooltipRow label="IST" value={now.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })} />
            </>
          }
        />
        <span
          className="status-btn static font-mono"
          style={{ display: 'flex', alignItems: 'center', gap: 5, color: marketDot === true ? 'var(--green)' : marketDot === 'warn' ? 'var(--amber)' : 'var(--text-muted)' }}
        >
          <span className={`status-dot ${marketDot === null ? 'unknown' : marketDot === 'warn' ? 'warn' : marketDot ? 'ok' : 'bad'}`} />
          <span className="status-btn-label">NSE {marketLabel}</span>
        </span>
        <StatusItem
          icon={Gauge} label={backend.latencyMs != null ? `${backend.latencyMs}ms` : '—'}
          as="span" className="status-btn static"
          tooltip={
            <>
              <div className="status-tooltip-title">API Latency</div>
              <TooltipRow label="Last check" value={backend.latencyMs != null ? `${backend.latencyMs} ms round-trip` : '—'} />
            </>
          }
        />
        {backend.region && (
          <span className="status-btn static status-btn-label" style={{ color: 'var(--text-dim)' }}>
            {backend.region}
          </span>
        )}
        <span className="status-btn static status-btn-label" style={{ color: 'var(--text-dim)' }}>
          {backend.version ? `v${backend.version}` : ''}
        </span>
      </div>

      <div className="status-bar-divider" />

      {/* ── Right: net speed, notifications, shortcuts, version ─────────── */}
      <div className="status-bar-section right">
        {netInfo && (
          <StatusItem
            icon={Wifi} label={netInfo.effectiveType?.toUpperCase()}
            as="span" className="status-btn static"
            tooltip={
              <>
                <div className="status-tooltip-title">Connection</div>
                <TooltipRow label="Type"     value={netInfo.effectiveType?.toUpperCase() || '—'} />
                <TooltipRow label="Downlink" value={netInfo.downlink != null ? `${netInfo.downlink} Mbps` : '—'} />
              </>
            }
          />
        )}

        <div className="status-item" ref={notifRef}>
          <button className="status-btn" onClick={toggleNotif} aria-label="Notifications" aria-expanded={notifOpen} style={{ position: 'relative' }}>
            <Bell size={11.5} strokeWidth={2} />
            <span className="status-btn-label">Alerts</span>
            {unseenCount > 0 && <span className="status-badge-count">{unseenCount > 9 ? '9+' : unseenCount}</span>}
          </button>
          {notifOpen && (
            <div className="notif-dropdown">
              {trades.length === 0 ? (
                <div className="notif-empty">No trades yet this session</div>
              ) : (
                trades.slice(0, 8).map((t, i) => (
                  <div key={i} className="notif-row">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span className="font-mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {t.symbol || t.action}
                      </span>
                      <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {t.action} · qty {t.qty ?? t.quantity ?? '—'}
                      </span>
                    </div>
                    <span className={`badge ${t.action === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>
                      {t.action}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <StatusItem
          icon={Keyboard} label="⌘"
          as="button" onClick={onOpenShortcuts} aria-label="Keyboard shortcuts"
          tooltip={
            <>
              <div className="status-tooltip-title">Keyboard Shortcuts</div>
              <TooltipRow label="Open help" value="?" />
            </>
          }
        />

        {backend.version && (
          <span className="status-btn static status-btn-label" style={{ color: 'var(--text-dim)', paddingRight: 2 }}>
            SYSTRA v{backend.version}
          </span>
        )}
      </div>
    </footer>
  );
}
