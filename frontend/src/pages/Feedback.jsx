import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { authAPI } from '../services/api';
import { MessageSquare, Star, Send, CheckCircle, AlertCircle, ChevronLeft } from 'lucide-react';

const TYPES = [
  { value:'bug',       label:'🐛 Bug Report',      desc:'Something is broken' },
  { value:'feature',   label:'💡 Feature Request',  desc:'Something to add' },
  { value:'ux',        label:'🎨 UI / UX',          desc:'Design feedback' },
  { value:'data',      label:'📊 Data / Accuracy',  desc:'Price or signal issues' },
  { value:'general',   label:'💬 General',           desc:'Anything else' },
];

function StarRating({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button"
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          style={{ background:'none', border:'none', cursor:'pointer', padding:'2px', transition:'transform 0.1s' }}
          onMouseDown={e => e.currentTarget.style.transform='scale(0.88)'}
          onMouseUp={e => e.currentTarget.style.transform='scale(1)'}
        >
          <Star size={22} style={{
            color: n <= (hover || value) ? 'var(--amber)' : 'var(--border-bright)',
            fill:  n <= (hover || value) ? 'var(--amber)' : 'none',
            transition: 'color 0.12s, fill 0.12s',
          }}/>
        </button>
      ))}
      {value > 0 && (
        <span className="font-mono" style={{ fontSize:11, color:'var(--amber)', alignSelf:'center', marginLeft:6 }}>
          {['','Poor','Fair','Good','Great','Excellent'][value]}
        </span>
      )}
    </div>
  );
}

export default function Feedback() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name:'', email:'', type:'general', message:'', rating:0 });
  const [loading,  setLoading]  = useState(false);
  const [success,  setSuccess]  = useState(false);
  const [error,    setError]    = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.message.trim().length < 10) { setError('Please write at least 10 characters.'); return; }
    setLoading(true); setError('');
    try {
      await authAPI.submitFeedback({ ...form, rating: form.rating || null });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit. Please try again.');
    } finally { setLoading(false); }
  }

  if (success) {
    return (
      <AppShell>
        <div className="page-content" style={{ maxWidth:560, margin:'60px auto', textAlign:'center' }}>
          <div style={{
            width:72, height:72, borderRadius:20, margin:'0 auto 20px',
            background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <CheckCircle size={32} style={{ color:'var(--green)'}}/>
          </div>
          <h2 style={{ fontSize:22, fontWeight:700, color:'var(--text-primary)', marginBottom:10 }}>
            Thanks for the feedback!
          </h2>
          <p style={{ fontSize:14, color:'var(--text-muted)', lineHeight:1.7, marginBottom:28 }}>
            We read every submission and use it to improve SYSTRA.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => setSuccess(false)} className="btn btn-ghost">Submit another</button>
            <button onClick={() => navigate('/')}     className="btn btn-cyan">Back to Dashboard</button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-content" style={{ maxWidth:640 }}>
        {/* Header */}
        <div style={{ marginBottom:28 }}>
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 btn btn-ghost"
            style={{ padding:'5px 10px', marginBottom:16, fontSize:12 }}>
            <ChevronLeft size={13}/> Back
          </button>
          <div className="flex items-center gap-3">
            <div style={{
              width:40, height:40, borderRadius:12,
              background:'rgba(59,130,246,0.1)', border:'1px solid rgba(59,130,246,0.2)',
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              <MessageSquare size={18} style={{ color:'var(--cyan)'}}/>
            </div>
            <div>
              <h1 style={{ fontSize:22, fontWeight:700, color:'var(--text-primary)' }}>Share Feedback</h1>
              <p style={{ fontSize:13, color:'var(--text-muted)' }}>Help us make SYSTRA better</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 font-mono" style={{
            padding:'10px 14px', borderRadius:8, marginBottom:20,
            background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)',
            color:'var(--red)', fontSize:12,
          }}>
            <AlertCircle size={13}/> {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Type selector */}
          <div className="card" style={{ padding:20, marginBottom:16 }}>
            <label className="section-label" style={{ display:'block', marginBottom:12 }}>Category</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(175px, 1fr))', gap:8 }}>
              {TYPES.map(t => (
                <button key={t.value} type="button"
                  onClick={() => set('type', t.value)}
                  style={{
                    padding:'10px 14px', borderRadius:10, textAlign:'left', cursor:'pointer',
                    border: `1px solid ${form.type === t.value ? 'rgba(59,130,246,0.4)' : 'var(--border)'}`,
                    background: form.type === t.value ? 'rgba(59,130,246,0.08)' : 'var(--bg-elevated)',
                    transition:'all 0.12s',
                  }}
                >
                  <div style={{ fontSize:13, fontWeight:600, color: form.type === t.value ? 'var(--cyan)' : 'var(--text-primary)', marginBottom:2 }}>
                    {t.label}
                  </div>
                  <div className="font-mono" style={{ fontSize:10, color:'var(--text-muted)' }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Rating */}
          <div className="card" style={{ padding:20, marginBottom:16 }}>
            <label className="section-label" style={{ display:'block', marginBottom:12 }}>Overall Rating (optional)</label>
            <StarRating value={form.rating} onChange={v => set('rating', v)} />
          </div>

          {/* Message */}
          <div className="card" style={{ padding:20, marginBottom:16 }}>
            <label className="section-label" style={{ display:'block', marginBottom:8 }}>Your Feedback *</label>
            <textarea
              value={form.message}
              onChange={e => set('message', e.target.value)}
              placeholder="Describe what you experienced, what you'd like to see, or any issues you encountered..."
              rows={5}
              className="input"
              style={{ resize:'vertical', minHeight:120, lineHeight:1.6, fontSize:13, fontFamily:'var(--font-ui)' }}
            />
            <div className="font-mono" style={{ fontSize:10, color: form.message.length < 10 ? 'var(--red)' : 'var(--text-muted)', marginTop:6, textAlign:'right' }}>
              {form.message.length} chars {form.message.length < 10 ? `(need ${10 - form.message.length} more)` : '✓'}
            </div>
          </div>

          {/* Contact (optional) */}
          <div className="card" style={{ padding:20, marginBottom:24 }}>
            <label className="section-label" style={{ display:'block', marginBottom:12 }}>Contact Info (optional)</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <label style={{ fontSize:11, color:'var(--text-muted)', display:'block', marginBottom:5 }}>Name</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder="Your name" className="input" style={{ fontSize:13 }}/>
              </div>
              <div>
                <label style={{ fontSize:11, color:'var(--text-muted)', display:'block', marginBottom:5 }}>Email</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="For follow-up" className="input" style={{ fontSize:13 }}/>
              </div>
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn btn-cyan flex items-center gap-2"
            style={{ padding:'11px 28px', fontSize:13, fontWeight:600 }}>
            {loading ? 'Submitting…' : <><Send size={13}/> Submit Feedback</>}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
