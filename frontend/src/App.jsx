import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { AuthProvider }  from './context/AuthContext';
import { WSProvider }    from './context/WSContext';
import { ThemeProvider } from './context/ThemeContext';
import { TradingModeProvider } from './context/TradingModeContext';
import ProtectedRoute   from './components/ProtectedRoute';

const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Screener = lazy(() => import('./pages/Screener'));
const Backtest = lazy(() => import('./pages/Backtest'));
const Signals = lazy(() => import('./pages/Signals'));
const LiveTrading = lazy(() => import('./pages/LiveTrading'));
const Trade = lazy(() => import('./pages/Trade'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Feedback = lazy(() => import('./pages/Feedback'));
const Analytics = lazy(() => import('./pages/Analytics'));
const TradeJournal = lazy(() => import('./pages/TradeJournal'));

function RouteFallback() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-base)',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
    }}>
      Loading SYSTRA...
    </div>
  );
}

// Show toast on Upstox OAuth redirect
function UpstoxCallback() {
  const [params] = useSearchParams();
  useEffect(() => {
    const status = params.get('upstox');
    const reason = params.get('reason');
    if (status === 'connected') {
      setTimeout(() => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;border-radius:10px;background:var(--bg-elevated);border:1px solid color-mix(in srgb, var(--green) 40%, transparent);color:var(--green);font-family:monospace;font-size:13px;font-weight:600;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
        el.textContent = '✅ Upstox connected — LIVE trading enabled';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 5000);
      }, 500);
    } else if (status === 'error') {
      setTimeout(() => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;border-radius:10px;background:var(--bg-elevated);border:1px solid color-mix(in srgb, var(--red) 40%, transparent);color:var(--red);font-family:monospace;font-size:13px;font-weight:600;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
        el.textContent = `❌ Upstox error: ${reason || 'unknown'}`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 6000);
      }, 500);
    }
  }, [params]);
  return null;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WSProvider>
          <TradingModeProvider>
          <BrowserRouter>
            <UpstoxCallback />
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/live" element={<ProtectedRoute><LiveTrading /></ProtectedRoute>} />
                <Route path="/screener" element={<ProtectedRoute><Screener /></ProtectedRoute>} />
                <Route path="/backtest" element={<ProtectedRoute><Backtest /></ProtectedRoute>} />
                <Route path="/signals" element={<ProtectedRoute><Signals /></ProtectedRoute>} />
                <Route path="/trade" element={<ProtectedRoute><Trade /></ProtectedRoute>} />
                <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
                <Route path="/feedback" element={<ProtectedRoute><Feedback /></ProtectedRoute>} />
                <Route path="/journal" element={<ProtectedRoute><TradeJournal /></ProtectedRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          </TradingModeProvider>
        </WSProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
