import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authAPI } from '../services/api';
import { useThemeContext } from '../context/ThemeContext';
import { Sun, Moon, ArrowLeft, Mail, CheckCircle, AlertCircle } from 'lucide-react';

function SystraLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="36" height="36" rx="10" fill="rgba(59,130,246,0.12)" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
      <polyline points="6,26 11,18 16,22 21,12 26,16 30,10" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="26" cy="10" r="2" fill="var(--cyan)"/>
      <line x1="6" y1="29" x2="30" y2="29" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
    </svg>
  );
}

export default function ForgotPassword() {
  const { isDark, toggleTheme } = useThemeContext();
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');
  const [devToken, setDevToken] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email) { setError('Email is required'); return; }
    setLoading(true); setError('');
    try {
      const res = await authAPI.forgotPassword(email);
      setSent(true);
      if (res.data._devToken) setDevToken(res.data._devToken);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative grid-bg" style={{ background: 'var(--bg-base)' }}>
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
          {!sent ? (
            <>
              <div style={{ marginBottom:24 }}>
                <h1 style={{ fontSize:20, fontWeight:700, color:'var(--text-primary)', marginBottom:6 }}>Reset Password</h1>
                <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.6 }}>
                  Enter your email and we'll send you a link to reset your password.
                </p>
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
                <div style={{ marginBottom:20 }}>
                  <label className="section-label" style={{ display:'block', marginBottom:6 }}>Email Address</label>
                  <div style={{ position:'relative' }}>
                    <Mail size={14} style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="trader@example.com" autoComplete="email"
                      className="input font-mono" style={{ paddingLeft:36, fontSize:13 }}
                    />
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn btn-cyan" style={{ width:'100%', justifyContent:'center', padding:'10px 0', fontSize:13 }}>
                  {loading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>
            </>
          ) : (
            <div style={{ textAlign:'center', padding:'8px 0' }}>
              <div style={{
                width:56, height:56, borderRadius:16, margin:'0 auto 16px',
                background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)',
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <CheckCircle size={26} style={{ color:'var(--green)' }}/>
              </div>
              <h2 style={{ fontSize:18, fontWeight:700, color:'var(--text-primary)', marginBottom:8 }}>Check your email</h2>
              <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7, marginBottom:20 }}>
                If <strong style={{ color:'var(--text-secondary)' }}>{email}</strong> is registered, you'll receive a reset link shortly.
              </p>
              {devToken && (
                <div style={{
                  padding:'10px 12px', borderRadius:8, marginBottom:16,
                  background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)',
                  textAlign:'left',
                }}>
                  <p className="font-mono" style={{ fontSize:10, color:'var(--amber)', marginBottom:6 }}>DEV MODE — Reset token:</p>
                  <p className="font-mono" style={{ fontSize:10, color:'var(--text-secondary)', wordBreak:'break-all' }}>{devToken}</p>
                  <Link to={`/reset-password?token=${devToken}`} style={{ color:'var(--cyan)', fontSize:11, marginTop:6, display:'inline-block' }}>
                    → Use this token to reset
                  </Link>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)', textAlign:'center' }}>
            <Link to="/login" className="flex items-center justify-center gap-2 font-mono" style={{ fontSize:12, color:'var(--text-muted)', textDecoration:'none' }}>
              <ArrowLeft size={12}/> Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
