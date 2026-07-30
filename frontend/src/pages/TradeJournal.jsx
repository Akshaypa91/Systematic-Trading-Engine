import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { tradeJournalAPI, simAPI } from '../services/api';
import { BookOpen, RefreshCw, Save, Trash2, PenLine, X } from 'lucide-react';

const emptyForm = {
  symbol: '',
  side: 'BUY',
  tradeId: null,
  entryReason: '',
  exitReason: '',
  notes: '',
  confidenceScore: '',
  screenshotUrl: '',
  tags: '',
  lessonsLearned: '',
};

const fmt = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function Stat({ label, value, sub }) {
  return (
    <div className="card journal-stat">
      <span className="section-label">{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export default function TradeJournal() {
  const [entries, setEntries] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [trades, setTrades] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // The user's real executed trades come along for the ride: a journal you
      // have to retype your trades into never gets filled in. Portfolio failing
      // (not initialised yet) must not break the journal itself.
      const [listRes, analyticsRes, portRes] = await Promise.all([
        tradeJournalAPI.list({ limit: 100 }),
        tradeJournalAPI.analytics(),
        simAPI.getPortfolio().catch(() => null),
      ]);
      setEntries(listRes.data?.data || []);
      setAnalytics(analyticsRes.data?.data || null);
      setTrades(portRes?.data?.data?.trades || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const topTags = useMemo(() => analytics?.topTags || [], [analytics]);

  // Trades that have no journal entry yet — the actual to-do list of this page.
  const unjournaled = useMemo(() => {
    const done = new Set(entries.map(e => String(e.tradeId)).filter(id => id !== 'null'));
    return trades.filter(t => t.id != null && !done.has(String(t.id))).slice(0, 8);
  }, [trades, entries]);

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  // Prefill from a real trade so the user only writes the part a machine can't:
  // why they took it and what they learned.
  function journalTrade(t) {
    setForm({
      ...emptyForm,
      symbol: t.symbol,
      side: t.side === 'SELL' ? 'SELL' : 'BUY',
      tradeId: t.id,
    });
    document.getElementById('journal-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await tradeJournalAPI.create({
        ...form,
        symbol: form.symbol.toUpperCase().trim(),
        confidenceScore: form.confidenceScore === '' ? null : Number(form.confidenceScore),
        tags: form.tags,
      });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    setError('');
    try {
      await tradeJournalAPI.remove(id);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  return (
    <AppShell>
      <main className="page-content journal-page">
        <div className="journal-header">
          <div>
            <div className="journal-title-row">
              <BookOpen size={18} style={{ color: 'var(--cyan)' }} />
              <h1>Trade Journal</h1>
            </div>
            <p className="font-mono">Reasoning, screenshots, lessons, and post-trade review</p>
          </div>
          <button onClick={load} className="btn btn-ghost" disabled={loading}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>

        {error && <div className="journal-error">{error}</div>}

        {/* Stats appear once there's something to summarise. Four tiles reading
            "0 / – / 0 / 0" made the page look broken on every first visit. */}
        {entries.length > 0 && (
          <section className="journal-stats">
            <Stat label="Entries" value={fmt(analytics?.totalEntries)} />
            <Stat label="Avg Confidence" value={analytics?.avgConfidence == null ? '-' : `${fmt(analytics.avgConfidence)}%`} />
            <Stat label="Trades Journaled" value={`${entries.filter(e => e.tradeId != null).length}/${trades.length || 0}`} sub="Linked to a real fill" />
            <Stat label="Buy / Sell" value={`${fmt(analytics?.buyNotes)} / ${fmt(analytics?.sellNotes)}`} />
          </section>
        )}

        <div className="journal-layout">
          <form id="journal-form" className="card journal-form" onSubmit={submit}>
            <h2>{form.tradeId ? `Journal ${form.symbol} ${form.side}` : 'New Journal Entry'}</h2>

            {/* Linked-trade chip: makes it obvious this note is attached to a
                real fill (trade_journal.trade_id), not a free-floating note. */}
            {form.tradeId && (
              <div className="journal-linked">
                <span>Linked to trade #{form.tradeId}</span>
                <button type="button" onClick={() => setForm(emptyForm)} title="Unlink and clear">
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="journal-form-grid">
              <label>
                Symbol
                <input value={form.symbol} onChange={e => updateField('symbol', e.target.value)} placeholder="RELIANCE" required />
              </label>
              <label>
                Side
                <select value={form.side} onChange={e => updateField('side', e.target.value)}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </label>
              <label>
                Confidence
                <input type="number" min="0" max="100" value={form.confidenceScore} onChange={e => updateField('confidenceScore', e.target.value)} placeholder="0-100" />
              </label>
              <label>
                Tags
                <input value={form.tags} onChange={e => updateField('tags', e.target.value)} placeholder="breakout, discipline" />
              </label>
            </div>
            <label>
              Entry Reason
              <textarea value={form.entryReason} onChange={e => updateField('entryReason', e.target.value)} rows={3} placeholder="Why this trade was valid" />
            </label>
            <label>
              Exit Reason
              <textarea value={form.exitReason} onChange={e => updateField('exitReason', e.target.value)} rows={2} placeholder="What invalidated or completed the setup" />
            </label>
            <label>
              Notes
              <textarea value={form.notes} onChange={e => updateField('notes', e.target.value)} rows={3} placeholder="Execution, psychology, sizing, context" />
            </label>
            <label>
              Screenshot URL
              <input value={form.screenshotUrl} onChange={e => updateField('screenshotUrl', e.target.value)} placeholder="https://..." />
            </label>
            <label>
              Lessons Learned
              <textarea value={form.lessonsLearned} onChange={e => updateField('lessonsLearned', e.target.value)} rows={3} placeholder="What to repeat or avoid next time" />
            </label>
            <button className="btn btn-cyan" disabled={saving}>
              <Save size={14} />
              {saving ? 'Saving...' : 'Save Entry'}
            </button>
          </form>

          <section className="journal-list">
            {topTags.length > 0 && (
              <div className="card journal-tags">
                <span className="section-label">Top Tags</span>
                <div>
                  {topTags.map(t => <span key={t.tag}>{t.tag} · {t.count}</span>)}
                </div>
              </div>
            )}

            {/* Un-journaled real trades — one click prefills the form. This is
                what turns the journal from a blank page into a worklist. */}
            {unjournaled.length > 0 && (
              <div className="card journal-todo">
                <span className="section-label">Trades awaiting a note</span>
                <div className="journal-todo-list">
                  {unjournaled.map(t => (
                    <button key={t.id} type="button" onClick={() => journalTrade(t)} className="journal-todo-row">
                      <span className="jt-sym">{t.symbol}</span>
                      <span className={`badge ${t.side === 'SELL' ? 'badge-sell' : 'badge-buy'}`}>{t.side}</span>
                      <span className="jt-price font-mono">₹{fmt(t.price)}</span>
                      {t.pnl != null && (
                        <span className="jt-pnl font-mono" style={{ color: t.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {t.pnl >= 0 ? '+' : ''}₹{fmt(t.pnl)}
                        </span>
                      )}
                      <PenLine size={12} className="jt-icon" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading ? (
              <div className="card journal-empty">Loading journal...</div>
            ) : entries.length === 0 ? (
              <div className="card journal-empty">
                <BookOpen size={24} style={{ color: 'var(--text-dim)', marginBottom: 10 }} />
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  No entries yet
                </p>
                <p style={{ fontSize: 11.5, lineHeight: 1.6, maxWidth: 380, margin: '0 auto' }}>
                  {unjournaled.length > 0
                    ? 'Pick a trade above to write up why you took it — reviewing your own reasoning is the fastest way to find repeated mistakes.'
                    : 'Once you place paper trades they appear here to annotate. You can also write a standalone note using the form.'}
                </p>
              </div>
            ) : entries.map(entry => (
              <article key={entry.id} className="card journal-entry">
                <div className="journal-entry-head">
                  <div>
                    <strong>{entry.symbol}</strong>
                    <span className={`badge ${entry.side === 'SELL' ? 'badge-sell' : 'badge-buy'}`}>{entry.side || 'TRADE'}</span>
                  </div>
                  <button className="btn btn-ghost" onClick={() => remove(entry.id)} title="Delete journal entry">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="journal-entry-meta font-mono">
                  {new Date(entry.createdAt).toLocaleString('en-IN')}
                  {entry.confidenceScore != null && ` · ${entry.confidenceScore}% confidence`}
                  {entry.tradeId != null && ` · trade #${entry.tradeId}`}
                </div>
                {entry.entryReason && <p><b>Entry:</b> {entry.entryReason}</p>}
                {entry.exitReason && <p><b>Exit:</b> {entry.exitReason}</p>}
                {entry.notes && <p>{entry.notes}</p>}
                {entry.lessonsLearned && <p><b>Lesson:</b> {entry.lessonsLearned}</p>}
                {entry.screenshotUrl && <a href={entry.screenshotUrl} target="_blank" rel="noreferrer">Open screenshot</a>}
                {entry.tags?.length > 0 && (
                  <div className="journal-entry-tags">
                    {entry.tags.map(tag => <span key={tag}>{tag}</span>)}
                  </div>
                )}
              </article>
            ))}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
