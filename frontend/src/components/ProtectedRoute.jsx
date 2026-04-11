// FIX: Use useAuth() so ProtectedRoute reacts to login/logout state changes
// instead of reading localStorage directly (which is not reactive).
import { Navigate } from 'react-router-dom';
import { useAuth }  from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
