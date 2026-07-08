import Skeleton from './Skeleton';

/**
 * DataTable — dense, terminal-grade table primitive.
 * columns: [{ key, label, align?: 'right', width?, render?: (row) => node }]
 * Standardizes header styling, hover rows, tabular figures and empty/loading
 * states so pages stop hand-rolling <table> markup.
 */
export default function DataTable({
  columns = [],
  rows = [],
  rowKey = (_r, i) => i,
  loading = false,
  loadingRows = 5,
  empty = null,
  onRowClick,
  maxHeight,
}) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
        {[...Array(loadingRows)].map((_, i) => <Skeleton key={i} h={34} />)}
      </div>
    );
  }
  if (!rows.length && empty) return empty;

  return (
    <div className="scroll-y" style={{ overflowX: 'auto', maxHeight }}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'right' : ''} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'right' : ''}>
                  {c.render ? c.render(row, i) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
