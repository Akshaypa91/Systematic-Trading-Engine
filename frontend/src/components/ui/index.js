// SYSTRA Design System — primitive component library.
// Single import surface: `import { Button, Card, Metric } from '../components/ui';`
//
// These primitives wrap the CSS token layer in src/index.css. Prefer them over
// hand-written inline styles so spacing, color, focus and theming stay
// consistent across every page.

export { default as Button } from './Button';
export { Card, CardHeader } from './Card';
export { default as Badge } from './Badge';
export { signalTone, signalColor } from './signal';
export { Field, Input, Select, TextArea } from './Field';
export { default as Metric } from './Metric';
export { default as Chip } from './Chip';
export { default as Skeleton } from './Skeleton';
export { default as EmptyState } from './EmptyState';
export { default as SectionLabel } from './SectionLabel';
export { default as PageHeader } from './PageHeader';
export { default as Sparkline } from './Sparkline';
export { default as SegmentedControl } from './SegmentedControl';
export { default as Tooltip } from './Tooltip';
export { default as DataTable } from './DataTable';
