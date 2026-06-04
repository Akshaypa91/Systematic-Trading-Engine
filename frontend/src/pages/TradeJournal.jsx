import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { tradeJournalAPI } from '../services/api';
import { BookOpen, RefreshCw, Save, Trash2 } from 'lucide-react';

const emptyForm = {
  symbol: '',
  side: 'BUY',
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
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [listRes, analyticsRes] = await Promise.all([
        tradeJournalAPI.list({ limit: 100 }),
        tradeJournalAPI.analytics(),
      ]);
      setEntries(listRes.data?.data || []);
      setAnalytics(analyticsRes.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const topTags = useMemo(() => analytics?.topTags || [], [analytics]);

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
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

        <section className="journal-stats">
          <Stat label="Entries" value={fmt(analytics?.totalEntries)} />
          <Stat label="Avg Confidence" value={analytics?.avgConfidence == null ? '-' : `${fmt(analytics.avgConfidence)}%`} />
          <Stat label="Buy Notes" value={fmt(analytics?.buyNotes)} />
          <Stat label="Sell Notes" value={fmt(analytics?.sellNotes)} />
        </section>

        <div className="journal-layout">
          <form className="card journal-form" onSubmit={submit}>
            <h2>New Journal Entry</h2>
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

            {loading ? (
              <div className="card journal-empty">Loading journal...</div>
            ) : entries.length === 0 ? (
              <div className="card journal-empty">No journal entries yet.</div>
            ) : entries.map(entry => (
              <article key={entry.id} className="card journal-entry">
                <div className="journal-entry-head">
                  <div>
                    <strong>{entry.symbol}</strong>
                    <span className={entry.side === 'SELL' ? 'badge-sell' : 'badge-buy'}>{entry.side || 'TRADE'}</span>
                  </div>
                  <button className="btn btn-ghost" onClick={() => remove(entry.id)} title="Delete journal entry">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="journal-entry-meta font-mono">
                  {new Date(entry.createdAt).toLocaleString('en-IN')}
                  {entry.confidenceScore != null && ` · ${entry.confidenceScore}% confidence`}
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
