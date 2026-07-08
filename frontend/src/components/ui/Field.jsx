/**
 * Field / Input / Select / TextArea — form primitives.
 * Field wraps a labelled control and wires the label to the control via
 * htmlFor/id for screen-reader + click-to-focus accessibility (previously
 * labels were plain <label> with no association).
 */
import { useId } from 'react';

export function Field({ label, hint, children, className = '', style }) {
  const id = useId();
  // Clone the control to inject the generated id if it doesn't already have one.
  const control =
    children && children.props && !children.props.id
      ? { ...children, props: { ...children.props, id } }
      : children;
  return (
    <div className={className} style={style}>
      {label && (
        <label
          className="section-label"
          htmlFor={id}
          style={{ display: 'block', marginBottom: 5 }}
        >
          {label}
        </label>
      )}
      {control}
      {hint && (
        <p className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Input({ className = '', ...rest }) {
  return <input className={`input ui-input ${className}`.trim()} {...rest} />;
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select className={`input ui-select ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

export function TextArea({ className = '', ...rest }) {
  return <textarea className={`input ui-textarea ${className}`.trim()} {...rest} />;
}

export default Field;
