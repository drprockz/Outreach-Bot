import React, { useEffect, useState } from 'react';
import { api } from '../../api';

export default function SavedViews({ currentFilters, currentSort, onApply }) {
  const [views, setViews] = useState([]);
  const [showDialog, setShowDialog] = useState(false);
  const [name, setName] = useState('');

  function refresh() {
    api.listSavedViews().then(d => setViews(d?.views || [])).catch(() => setViews([]));
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!name.trim()) return;
    await api.createSavedView({
      name: name.trim(),
      filtersJson: currentFilters,
      sort: currentSort || null,
    });
    setName('');
    setShowDialog(false);
    refresh();
  }

  async function rename(id, oldName) {
    const next = window.prompt('Rename view', oldName);
    if (next && next.trim() && next !== oldName) {
      await api.updateSavedView(id, { name: next.trim() });
      refresh();
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this saved view?')) return;
    await api.deleteSavedView(id);
    refresh();
  }

  return (
    <div className="saved-views">
      {views.map(v => (
        <span key={v.id} className="view-chip">
          <button className="chip-apply" onClick={() => onApply(v)}>{v.name}</button>
          <button className="chip-edit" title="Rename" onClick={() => rename(v.id, v.name)}>✎</button>
          <button className="chip-del" title="Delete" onClick={() => remove(v.id)}>✕</button>
        </span>
      ))}
      <button className="btn" onClick={() => setShowDialog(true)}>★ Save current view</button>
      {showDialog && (
        <div className="dialog">
          <input
            className="input"
            placeholder="View name…"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <button className="btn" onClick={save}>Save</button>
          <button className="btn" onClick={() => setShowDialog(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
