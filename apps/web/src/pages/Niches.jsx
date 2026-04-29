import React, { useEffect, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/radar/PageHeader';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const emptyForm = { label: '', query: '', day_of_week: null, enabled: 1 };

export default function Niches() {
  const [niches, setNiches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: 'add'|'edit', data: {...} }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null); // niche id

  // NOTE: Niches is a list-management page with per-row CRUD, not a single form,
  // so it doesn't fit the <SettingsPage> single-Save pattern. It consumes the
  // same {items} envelope via api.getNiches() which returns the array directly.
  function load() {
    api.getNiches().then(items => { setNiches(items || []); setLoading(false); });
  }
  useEffect(load, []);

  function openAdd() { setModal({ mode: 'add', data: { ...emptyForm } }); setError(''); }
  function openEdit(n) { setModal({ mode: 'edit', data: { ...n } }); setError(''); }
  function closeModal() { setModal(null); setError(''); }

  async function handleSave() {
    const { label, query, day_of_week, enabled } = modal.data;
    if (!label.trim()) return setError('Label is required.');
    if (!query.trim() || query.trim().length < 10) return setError('Query must be at least 10 characters.');

    setSaving(true);
    const payload = { label: label.trim(), query: query.trim(), day_of_week, enabled };
    if (modal.mode === 'add') {
      await api.createNiche(payload);
    } else {
      await api.updateNiche(modal.data.id, payload);
    }
    setSaving(false);
    closeModal();
    load();
  }

  async function handleToggle(niche) {
    await api.updateNiche(niche.id, { ...niche, enabled: niche.enabled ? 0 : 1 });
    load();
  }

  async function handleDelete(id) {
    await api.deleteNiche(id);
    setDeleteConfirm(null);
    load();
  }

  const scheduleGrid = [1, 2, 3, 4, 5, 6].map(day => ({
    day,
    label: DAYS[day],
    niche: niches.find(n => n.day_of_week === day) || null
  }));

  return (
    <div>
      <PageHeader title="Niches & Schedule" subtitle="Active niches and their daily run windows" />

      {/* Weekly schedule grid */}
      <div className="section-label" style={{ marginBottom: '12px' }}>Weekly Schedule</div>
      <div className="niche-grid">
        {scheduleGrid.map(({ day, label, niche }) => (
          <div
            key={day}
            className={`niche-day-card ${niche ? 'has-niche' : 'empty'}`}
            onClick={() => niche ? openEdit(niche) : openAdd()}
          >
            <div className="niche-day-label">{label}</div>
            {niche ? (
              <>
                <div className="niche-day-name">{niche.label}</div>
                <div className="niche-day-query">{niche.query.slice(0, 60)}…</div>
                <span className={`badge ${niche.enabled ? 'badge-green' : 'badge-muted'}`}>
                  {niche.enabled ? 'enabled' : 'disabled'}
                </span>
              </>
            ) : (
              <div className="niche-day-empty">+ Assign</div>
            )}
          </div>
        ))}
      </div>

      {/* Niche pool table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '32px 0 12px' }}>
        <div className="section-label">All Niches</div>
        <button className="btn-primary" onClick={openAdd}>+ Add Niche</button>
      </div>

      {loading ? <div className="td-muted">Loading…</div> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Query</th>
                <th>Day</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {niches.map(n => (
                <tr key={n.id}>
                  <td>{n.label}</td>
                  <td className="td-muted" style={{ maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.query}</td>
                  <td className="td-muted">{n.day_of_week ? DAYS[n.day_of_week] : <span className="td-dim">Unassigned</span>}</td>
                  <td>
                    <button
                      className={`badge ${n.enabled ? 'badge-green' : 'badge-muted'}`}
                      style={{ cursor: 'pointer', border: 'none', background: 'none' }}
                      onClick={() => handleToggle(n)}
                    >
                      {n.enabled ? 'enabled' : 'disabled'}
                    </button>
                  </td>
                  <td style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn-ghost" onClick={() => openEdit(n)}>Edit</button>
                    {deleteConfirm === n.id ? (
                      <>
                        <span className="td-dim" style={{ fontSize: '11px', alignSelf: 'center' }}>Confirm delete?</span>
                        <button className="btn-danger" onClick={() => handleDelete(n.id)}>Yes</button>
                        <button className="btn-ghost" onClick={() => setDeleteConfirm(null)}>No</button>
                      </>
                    ) : (
                      <button className="btn-ghost btn-ghost-red" onClick={() => setDeleteConfirm(n.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <>
          <div className="detail-overlay" onClick={closeModal} />
          <div className="detail-panel" style={{ maxWidth: '500px' }}>
            <button className="detail-close" onClick={closeModal}>✕</button>
            <h2 className="detail-title">{modal.mode === 'add' ? 'Add Niche' : 'Edit Niche'}</h2>

            {error && <div className="login-error" style={{ marginBottom: '12px' }}>{error}</div>}

            <div className="detail-label">Label</div>
            <input
              className="input"
              style={{ width: '100%', marginBottom: '12px' }}
              value={modal.data.label}
              onChange={e => setModal(m => ({ ...m, data: { ...m.data, label: e.target.value } }))}
              placeholder="e.g. Real estate agencies"
            />

            <div className="detail-label">Search Query</div>
            <textarea
              className="input"
              style={{ width: '100%', minHeight: '72px', marginBottom: '12px', resize: 'vertical' }}
              value={modal.data.query}
              onChange={e => setModal(m => ({ ...m, data: { ...m.data, query: e.target.value } }))}
              placeholder="Gemini grounding query used to discover leads"
            />

            <div className="detail-label">Assign to Day</div>
            <select
              className="select"
              style={{ width: '100%', marginBottom: '8px' }}
              value={modal.data.day_of_week ?? ''}
              onChange={e => setModal(m => ({ ...m, data: { ...m.data, day_of_week: e.target.value ? parseInt(e.target.value) : null } }))}
            >
              <option value="">Unassigned</option>
              {[1,2,3,4,5,6].map(d => <option key={d} value={d}>{DAYS[d]}</option>)}
            </select>

            {(() => {
              const conflict = niches.find(n => n.day_of_week === modal.data.day_of_week && modal.data.day_of_week !== null && n.id !== modal.data.id);
              return conflict ? (
                <div className="td-dim" style={{ fontSize: '11px', marginBottom: '8px', color: 'var(--amber)' }}>
                  ⚠ {DAYS[modal.data.day_of_week]} already has "{conflict.label}" — it will become Unassigned.
                </div>
              ) : null;
            })()}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
              <input
                type="checkbox"
                id="niche-enabled"
                checked={!!modal.data.enabled}
                onChange={e => setModal(m => ({ ...m, data: { ...m.data, enabled: e.target.checked ? 1 : 0 } }))}
              />
              <label htmlFor="niche-enabled" className="td-muted">Enabled</label>
            </div>

            <button className="login-btn" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Niche'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
