export default function MetricsCard({ label, value, sub, color = 'cyan', icon: Icon, trend, loading }) {
  const palette = {
    cyan:   { c:'var(--cyan)',   bg:'rgba(0,212,255,0.07)',   border:'rgba(0,212,255,0.18)' },
    green:  { c:'var(--green)',  bg:'rgba(0,229,160,0.07)',   border:'rgba(0,229,160,0.18)' },
    red:    { c:'var(--red)',    bg:'rgba(255,77,106,0.07)',   border:'rgba(255,77,106,0.18)' },
    amber:  { c:'var(--amber)',  bg:'rgba(255,176,32,0.07)',  border:'rgba(255,176,32,0.18)' },
    purple: { c:'var(--purple)', bg:'rgba(139,92,246,0.07)',  border:'rgba(139,92,246,0.18)' },
  };
  const p = palette[color] || palette.cyan;

  if (loading) {
    return (
      <div className="card" style={{ padding:20 }}>
        <div className="skeleton" style={{ width:80, height:10, marginBottom:12 }} />
        <div className="skeleton" style={{ width:120, height:24, marginBottom:8 }} />
        <div className="skeleton" style={{ width:100, height:9 }} />
      </div>
    );
  }

  return (
    <div className="card fade-up" style={{ padding:20, position:'relative', overflow:'hidden' }}>
      {/* Corner glow accent */}
      <div style={{ position:'absolute', top:-20, right:-20, width:80, height:80, borderRadius:'50%',
        background:`radial-gradient(circle, ${p.c}22, transparent 70%)`, pointerEvents:'none' }} />

      <div className="flex items-center justify-between" style={{ marginBottom:12 }}>
        <span className="section-label">{label}</span>
        {Icon && (
          <div style={{ width:28, height:28, borderRadius:8, background:p.bg, border:`1px solid ${p.border}`,
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Icon size={13} style={{ color:p.c }} />
          </div>
        )}
      </div>

      <div className="num-flip" style={{ fontSize:22, fontWeight:700, color:p.c, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>
        {value ?? '—'}
      </div>

      {sub && (
        <div className="font-mono" style={{ fontSize:11, color:'var(--text-secondary)', marginTop:8 }}>{sub}</div>
      )}

      {trend !== undefined && (
        <div className="font-mono" style={{ fontSize:11, marginTop:6, color: trend >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(2)}%
        </div>
      )}
    </div>
  );
}
