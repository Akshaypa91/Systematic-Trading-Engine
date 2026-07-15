// src/components/CreatorLinks.jsx — "Built by Akshay Pagare" + GitHub/LinkedIn.
// compact: icons only (status bar). full: name + icons (auth footer, pages).
import { Github, Linkedin } from 'lucide-react';
import { CREATOR } from '../config/creator';

function IconLink({ href, label, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 6,
        color: 'var(--text-muted)', transition: 'color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--text-primary) 8%, transparent)'; }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </a>
  );
}

export default function CreatorLinks({ compact = false, style }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 6, ...style }}>
      {!compact && (
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          Built by <b style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{CREATOR.name}</b>
        </span>
      )}
      <IconLink href={CREATOR.github} label={`${CREATOR.name} on GitHub`}>
        <Github size={compact ? 12 : 13} />
      </IconLink>
      <IconLink href={CREATOR.linkedin} label={`${CREATOR.name} on LinkedIn`}>
        <Linkedin size={compact ? 12 : 13} />
      </IconLink>
    </span>
  );
}
