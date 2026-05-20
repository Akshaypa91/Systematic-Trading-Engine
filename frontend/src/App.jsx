import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { AuthProvider }  from './context/AuthContext';
import { WSProvider }    from './context/WSContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute   from './components/ProtectedRoute';
import Login       from './pages/Login';
import Signup      from './pages/Signup';
import Dashboard   from './pages/Dashboard';
import Screener    from './pages/Screener';
import Backtest    from './pages/Backtest';
import Signals     from './pages/Signals';
import LiveTrading from './pages/LiveTrading';
import Trade          from './pages/Trade';
import ForgotPassword  from './pages/ForgotPassword';
import ResetPassword   from './pages/ResetPassword';
import Feedback        from './pages/Feedback';
import { useEffect } from 'react';
import Analytics from './pages/Analytics';

// Show toast on Upstox OAuth redirect
function UpstoxCallback() {
  const [params] = useSearchParams();
  useEffect(() => {
    const status = params.get('upstox');
    const reason = params.get('reason');
    if (status === 'connected') {
      setTimeout(() => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;border-radius:10px;background:#0d1b2a;border:1px solid rgba(0,229,160,0.4);color:#00e5a0;font-family:monospace;font-size:13px;font-weight:600;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
        el.textContent = '✅ Upstox connected — LIVE trading enabled';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 5000);
      }, 500);
    } else if (status === 'error') {
      setTimeout(() => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;border-radius:10px;background:#0d1b2a;border:1px solid rgba(255,77,106,0.4);color:#ff4d6a;font-family:monospace;font-size:13px;font-weight:600;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
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
          <BrowserRouter>
            <UpstoxCallback />
            <Routes>
              <Route path="/login"  element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="/signup" element={<Signup />} />
              <Route path="/"         element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/live"     element={<ProtectedRoute><LiveTrading /></ProtectedRoute>} />
              <Route path="/screener" element={<ProtectedRoute><Screener /></ProtectedRoute>} />
              <Route path="/backtest" element={<ProtectedRoute><Backtest /></ProtectedRoute>} />
              <Route path="/signals"  element={<ProtectedRoute><Signals /></ProtectedRoute>} />
              <Route path="/trade"    element={<ProtectedRoute><Trade /></ProtectedRoute>} />
              <Route path="*"         element={<Navigate to="/" replace />} />
              <Route path="/feedback" element={<ProtectedRoute><Feedback /></ProtectedRoute>} />
              <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
        </Routes>
          </BrowserRouter>
        </WSProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
