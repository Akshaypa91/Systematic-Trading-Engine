import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import { useThemeContext } from '../context/ThemeContext';
import { Sun, Moon, Eye, EyeOff, CheckCircle, AlertCircle, Lock } from 'lucide-react';

function SystraLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <rect width="36" height="36" rx="10" fill="rgba(59,130,246,0.12)" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
      <polyline points="6,26 11,18 16,22 21,12 26,16 30,10" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="26" cy="10" r="2" fill="var(--cyan)"/>
      <line x1="6" y1="29" x2="30" y2="29" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
    </svg>
  );
}

export default function ResetPassword() {
  const { isDark, toggleTheme } = useThemeContext();
  const [params]    = useSearchParams();
  const navigate    = useNavigate();
  const token       = params.get('token') || '';
  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [success,   setSuccess]   = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => { if (!token) setError('Invalid or missing reset token.'); }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm)  { setError('Passwords do not match'); return; }
    setLoading(true); setError('');
    try {
      await authAPI.resetPassword(token, password);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed. Token may have expired.');
    } finally { setLoading(false); }
  }

  const strength = password.length === 0 ? 0
    : password.length < 8 ? 1
    : password.length < 12 ? 2
    : /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4 : 3;
  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const strengthColor = ['', 'var(--red)', 'var(--amber)', 'var(--cyan)', 'var(--green)'];

  return (
    <div className="min-h-screen flex items-center justify-center relative grid-bg" style={{ background:'var(--bg-base)' }}>
      <button onClick={toggleTheme} style={{
        position:'fixed', top:16, right:16, zIndex:999,
        width:36, height:36, borderRadius:10, border:'1px solid var(--border)',
        background:'var(--bg-elevated)', color:'var(--text-muted)',
        display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
      }}>
        {isDark ? <Sun size={15}/> : <Moon size={15}/>}
      </button>

      <div className="w-full max-w-sm mx-4 fade-in">
        <div className="flex items-center justify-center gap-3 mb-8">
          <SystraLogo />
          <div>
            <div style={{ fontSize:15, fontWeight:700, letterSpacing:'0.08em', color:'var(--text-primary)' }}>SYSTRA</div>
            <div className="font-mono" style={{ fontSize:10, color:'var(--text-muted)' }}>Systematic Trading Engine</div>
          </div>
        </div>

        <div className="card" style={{ padding:32 }}>
          {success ? (
            <div style={{ textAlign:'center', padding:'8px 0' }}>
              <div style={{
                width:56, height:56, borderRadius:16, margin:'0 auto 16px',
                background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)',
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <CheckCircle size={26} style={{ color:'var(--green)'}}/>
              </div>
              <h2 style={{ fontSize:18, fontWeight:700, color:'var(--text-primary)', marginBottom:8 }}>Password Updated!</h2>
              <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7 }}>
                Your password has been reset. Redirecting to login...
              </p>
            </div>
          ) : (
            <>
              <div style={{ marginBottom:24 }}>
                <div style={{
                  width:44, height:44, borderRadius:12, marginBottom:16,
                  background:'rgba(59,130,246,0.1)', border:'1px solid rgba(59,130,246,0.2)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  <Lock size={20} style={{ color:'var(--cyan)' }}/>
                </div>
                <h1 style={{ fontSize:20, fontWeight:700, color:'var(--text-primary)', marginBottom:6 }}>New Password</h1>
                <p style={{ fontSize:13, color:'var(--text-muted)' }}>Choose a strong password for your account.</p>
              </div>

              {error && (
                <div className="flex items-center gap-2 font-mono" style={{
                  padding:'10px 12px', borderRadius:8, marginBottom:16,
                  background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)',
                  color:'var(--red)', fontSize:12,
                }}>
                  <AlertCircle size={13}/> {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom:16 }}>
                  <label className="section-label" style={{ display:'block', marginBottom:6 }}>New Password</label>
                  <div style={{ position:'relative' }}>
                    <input
                      type={showPw ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 8 characters" className="input font-mono"
                      style={{ paddingRight:40, fontSize:13 }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)} style={{
                      position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                      background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)',
                    }}>
                      {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
                    </button>
                  </div>
                  {password.length > 0 && (
                    <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ flex:1, height:3, borderRadius:99, background:'var(--bg-elevated)', overflow:'hidden' }}>
                        <div style={{
                          height:'100%', borderRadius:99,
                          width:`${(strength/4)*100}%`,
                          background: strengthColor[strength],
                          transition:'all 0.3s',
                        }}/>
                      </div>
                      <span className="font-mono" style={{ fontSize:10, color:strengthColor[strength] }}>{strengthLabel[strength]}</span>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom:24 }}>
                  <label className="section-label" style={{ display:'block', marginBottom:6 }}>Confirm Password</label>
                  <input
                    type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                    placeholder="Re-enter password" className="input font-mono"
                    style={{
                      fontSize:13,
                      borderColor: confirm && confirm !== password ? 'rgba(239,68,68,0.4)' : undefined,
                    }}
                  />
                </div>

                <button type="submit" disabled={loading || !token} className="btn btn-cyan"
                  style={{ width:'100%', justifyContent:'center', padding:'10px 0', fontSize:13 }}>
                  {loading ? 'Updating…' : 'Reset Password'}
                </button>
              </form>
            </>
          )}

          <div style={{ marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)', textAlign:'center' }}>
            <Link to="/login" className="font-mono" style={{ fontSize:12, color:'var(--text-muted)' }}>
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
