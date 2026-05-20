// src/components/Skeleton.jsx
// Usage: <SkeletonCard />, <SkeletonTable rows={5} />, <SkeletonMetric />
import React from 'react';

const base = {
  borderRadius: 6,
  background: 'linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-hover) 50%, var(--bg-elevated) 75%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.6s ease-in-out infinite',
};

export function SkeletonLine({ width = '100%', height = 14, style = {} }) {
  return <div style={{ ...base, width, height, marginBottom: 8, ...style }} />;
}

export function SkeletonMetric() {
  return (
    <div className="card" style={{ padding: 20 }}>
      <SkeletonLine width="45%" height={11} />
      <SkeletonLine width="60%" height={28} style={{ marginTop: 8, marginBottom: 4 }} />
      <SkeletonLine width="35%" height={11} />
    </div>
  );
}

export function SkeletonCard({ lines = 3, height = 120 }) {
  return (
    <div className="card" style={{ padding: 20, minHeight: height }}>
      <SkeletonLine width="55%" height={16} style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={`${65 + Math.sin(i) * 20}%`} height={12} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 5 }) {
  return (
    <div style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} width={`${100 / cols}%`} height={11} style={{ margin: 0 }} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonLine key={c} width={`${100 / cols}%`} height={13} style={{ margin: 0 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonSignalCard() {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <SkeletonLine width="30%" height={16} style={{ margin: 0 }} />
        <SkeletonLine width="20%" height={16} style={{ margin: 0 }} />
      </div>
      <SkeletonLine width="50%" height={24} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <SkeletonLine height={40} style={{ borderRadius: 8, margin: 0 }} />
        <SkeletonLine height={40} style={{ borderRadius: 8, margin: 0 }} />
      </div>
    </div>
  );
}

export function SkeletonChart({ height = 200 }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <SkeletonLine width="25%" height={14} style={{ margin: 0 }} />
        <SkeletonLine width="15%" height={14} style={{ margin: 0 }} />
      </div>
      <div style={{ ...base, height, borderRadius: 8, margin: 0 }} />
    </div>
  );
}

// Dashboard metrics row skeleton
export function SkeletonDashboard() {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[0,1,2,3].map(i => <SkeletonMetric key={i} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 12 }}>
        <SkeletonChart height={280} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0,1,2].map(i => <SkeletonSignalCard key={i} />)}
        </div>
      </div>
    </div>
  );
}