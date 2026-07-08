/**
 * SectionLabel — uppercase micro-heading used above panels and field groups.
 * Wraps the `.section-label` token class.
 */
export default function SectionLabel({ className = '', children, style, ...rest }) {
  return (
    <span className={`section-label ${className}`.trim()} style={style} {...rest}>
      {children}
    </span>
  );
}
