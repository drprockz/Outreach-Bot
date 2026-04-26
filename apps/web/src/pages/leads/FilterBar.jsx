import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const STATUS_OPTIONS = [
  'discovered', 'extracted', 'ready', 'queued', 'sent', 'replied', 'nurture',
  'bounced', 'email_not_found', 'email_invalid', 'judge_skipped',
  'extraction_failed', 'deduped', 'unsubscribed',
];
const PRIORITY_OPTIONS = ['A', 'B', 'C'];
const EMAIL_STATUS_OPTIONS = ['valid', 'invalid', 'risky', 'catch_all', 'unknown'];
const SIGNAL_TYPE_OPTIONS = ['hiring', 'funding', 'launch', 'press', 'product'];

export default function FilterBar({ filters, setFilter, setMany, clearFilters }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [facets, setFacets] = useState({ categories: [], cities: [], countries: [] });

  useEffect(() => {
    api.leadFacets().then(d => setFacets({
      categories: d?.categories || [],
      cities: d?.cities || [],
      countries: d?.countries || [],
    })).catch(() => {});
  }, []);

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <input
          className="input"
          placeholder="Search name / domain / email"
          value={filters.search || ''}
          onChange={e => setFilter('search', e.target.value)}
          style={{ width: 240 }}
        />
        <MultiSelect
          label="Status"
          options={STATUS_OPTIONS}
          value={filters.status || []}
          onChange={v => setFilter('status', v)}
        />
        <MultiSelect
          label="ICP"
          options={PRIORITY_OPTIONS}
          value={filters.icp_priority || []}
          onChange={v => setFilter('icp_priority', v)}
        />
        <MultiSelect
          label="Email"
          options={EMAIL_STATUS_OPTIONS}
          value={filters.email_status || []}
          onChange={v => setFilter('email_status', v)}
        />
        <input
          type="date"
          className="input"
          value={filters.date_from || ''}
          onChange={e => setFilter('date_from', e.target.value)}
        />
        <input
          type="date"
          className="input"
          value={filters.date_to || ''}
          onChange={e => setFilter('date_to', e.target.value)}
        />
        <button className="btn" onClick={() => setDrawerOpen(o => !o)}>
          More filters {drawerOpen ? '▴' : '▾'}
        </button>
        <button className="btn" onClick={clearFilters}>Clear</button>
      </div>
      {drawerOpen && (
        <div className="filter-drawer">
          <MultiSelect
            label="Category"
            options={facets.categories}
            value={filters.category || []}
            onChange={v => setFilter('category', v)}
          />
          <MultiSelect
            label="City"
            options={facets.cities}
            value={filters.city || []}
            onChange={v => setFilter('city', v)}
          />
          <MultiSelect
            label="Country"
            options={facets.countries}
            value={filters.country || []}
            onChange={v => setFilter('country', v)}
          />
          <MultiSelect
            label="Signal type"
            options={SIGNAL_TYPE_OPTIONS}
            value={filters.signal_type || []}
            onChange={v => setFilter('signal_type', v)}
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={filters.has_linkedin_dm === '1'}
              onChange={e => setFilter('has_linkedin_dm', e.target.checked ? '1' : '')}
            />
            Has LinkedIn DM
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={filters.has_signals === '1'}
              onChange={e => setFilter('has_signals', e.target.checked ? '1' : '')}
            />
            Has signals
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={filters.in_reject_list === 'all'}
              onChange={e => setFilter('in_reject_list', e.target.checked ? 'all' : '')}
            />
            Show rejected
          </label>
        </div>
      )}
    </div>
  );
}

function MultiSelect({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const summary = selected.length === 0 ? label : `${label} (${selected.length})`;

  function toggle(opt) {
    if (selected.includes(opt)) onChange(selected.filter(x => x !== opt));
    else onChange([...selected, opt]);
  }

  return (
    <div className="multi-select" style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen(o => !o)}>{summary} ▾</button>
      {open && (
        <div
          className="multi-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            padding: 8,
            zIndex: 10,
            minWidth: 160,
            maxHeight: 240,
            overflowY: 'auto',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {options.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 11, padding: '4px 0' }}>(no options)</div>
          )}
          {options.map(opt => (
            <label key={opt} style={{ display: 'block', padding: '4px 0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
              />
              {' '}{opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
