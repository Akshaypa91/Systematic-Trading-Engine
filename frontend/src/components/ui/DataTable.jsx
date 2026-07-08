import { useMemo, useState } from 'react';
import Skeleton from './Skeleton';

/**
 * DataTable — dense, terminal-grade table primitive.
 * columns: [{ key, label, align?: 'right', width?, render?: (row) => node,
 *             sortValue?: (row) => number|string, sortable?: boolean }]
 *
 * New in v4 (all opt-in, default behavior unchanged):
 *   sortable  — click column headers to sort (uses sortValue ?? row[key])
 *   pageSize  — client-side pagination with a slim pager footer
 * Sticky headers, hover rows, tabular figures, empty/loading states built in.
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
  sortable = false,
  defaultSort = null, // { key, dir: 'asc' | 'desc' }
  pageSize = 0,
}) {
  const [sort, setSort] = useState(defaultSort);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = (r) => (col?.sortValue ? col.sortValue(r) : r?.[sort.key]);
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const na = Number(va);
      const nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
      return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
    });
  }, [rows, sort, columns]);

  const pages = pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pages - 1);
  const visible = pageSize > 0 ? sorted.slice(safePage * pageSize, (safePage + 1) * pageSize) : sorted;

  function toggleSort(col) {
    const canSort = sortable || col.sortable;
    if (!canSort) return;
    setPage(0);
    setSort((prev) =>
      prev?.key === col.key
        ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col.key, dir: 'desc' }
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
        {[...Array(loadingRows)].map((_, i) => <Skeleton key={i} h={34} />)}
      </div>
    );
  }
  if (!rows.length && empty) return empty;

  return (
    <div>
      <div className="scroll-y" style={{ overflowX: 'auto', maxHeight }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => {
                const canSort = sortable || c.sortable;
                const isSorted = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={`${c.align === 'right' ? 'right' : ''} ${canSort ? 'sortable' : ''}`.trim()}
                    style={c.width ? { width: c.width } : undefined}
                    onClick={canSort ? () => toggleSort(c) : undefined}
                    aria-sort={isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    tabIndex={canSort ? 0 : undefined}
                    onKeyDown={canSort ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(c); } } : undefined}
                  >
                    {c.label}
                    {isSorted && <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
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

      {pageSize > 0 && sorted.length > pageSize && (
        <div className="table-pager">
          <span>
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="pager-btns">
            <button onClick={() => setPage(0)} disabled={safePage === 0} aria-label="First page">«</button>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} aria-label="Previous page">‹</button>
            <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={safePage >= pages - 1} aria-label="Next page">›</button>
            <button onClick={() => setPage(pages - 1)} disabled={safePage >= pages - 1} aria-label="Last page">»</button>
          </div>
        </div>
      )}
    </div>
  );
}
