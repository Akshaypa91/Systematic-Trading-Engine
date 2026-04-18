import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import Trade       from './pages/Trade';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WSProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login"  element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/"         element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/live"     element={<ProtectedRoute><LiveTrading /></ProtectedRoute>} />
              <Route path="/screener" element={<ProtectedRoute><Screener /></ProtectedRoute>} />
              <Route path="/backtest" element={<ProtectedRoute><Backtest /></ProtectedRoute>} />
              <Route path="/signals"  element={<ProtectedRoute><Signals /></ProtectedRoute>} />
              <Route path="/trade"    element={<ProtectedRoute><Trade /></ProtectedRoute>} />
              <Route path="*"         element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </WSProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
