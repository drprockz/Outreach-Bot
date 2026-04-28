import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../api';
import { useFiltersFromUrl } from './leads/useFiltersFromUrl';
import KpiStrip from './leads/KpiStrip';
import SavedViews from './leads/SavedViews';
import FilterBar from './leads/FilterBar';
import LeadsTable from './leads/LeadsTable';
import BulkActionBar from './leads/BulkActionBar';
import LeadDetailPanel from './leads/LeadDetailPanel';

const PAGE_SIZE = 25;

export default function Leads() {
  const { filters, setFilter, setMany, clearFilters } = useFiltersFromUrl();
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [detailLead, setDetailLead] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [retryStatus, setRetryStatus] = useState(null);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.set('page', String(page));
    sp.set('limit', String(PAGE_SIZE));
    return `?${sp.toString()}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page]);

  function fetchLeads() {
    setLoading(true);
    api.leads(queryString).then(d => {
      setLeads(d?.leads || []);
      setTotal(d?.total || 0);
    }).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { fetchLeads(); /* eslint-disable-next-line */ }, [queryString]);

  function openDetail(lead) {
    setDetailLead(lead);
    setDetailData(null);
    api.lead(lead.id).then(setDetailData).catch(() => setDetailData(null));
  }

  function closeDetail() { setDetailLead(null); setDetailData(null); }

  function toggleSelect(id) {
    setSelectedIds(s => s.includes(id) ? s.filter(x => x !== id) : s.concat(id));
  }
  function toggleSelectAll() {
    setSelectedIds(s => s.length === leads.length && leads.length > 0 ? [] : leads.map(l => l.id));
  }

  async function handleBulk(action) {
    if (selectedIds.length === 0) return;
    if (action.kind === 'status') {
      const verb = action.action;
      if (!window.confirm(`${verb} ${selectedIds.length} lead(s)?`)) return;
      const res = await api.bulkLeadStatus({ leadIds: selectedIds, action: verb });
      const skipped = (res?.skipped || []).length;
      window.alert(`${res?.updated || 0} updated${skipped ? `, ${skipped} skipped` : ''}.`);
      setSelectedIds([]);
      fetchLeads();
    } else if (action.kind === 'retry') {
      const dry = await api.bulkLeadRetryDryRun({ leadIds: selectedIds, stage: action.stage });
      const ok = window.confirm(
        `Retry "${action.stage}" on ${dry.count} lead(s).\n` +
        `Estimated cost: $${dry.estimated_cost_usd} (quality: ${dry.estimate_quality}).\n\nProceed?`
      );
      if (!ok) return;
      setRetryStatus({ running: true, total: selectedIds.length, done: 0, errors: 0 });
      try {
        await runStreamedRetry(selectedIds, action.stage, evt => {
          if (evt.status === 'ok') setRetryStatus(s => ({ ...s, done: s.done + 1 }));
          else if (evt.status === 'error') setRetryStatus(s => ({ ...s, done: s.done + 1, errors: s.errors + 1 }));
        });
      } catch (err) {
        window.alert(`Retry failed: ${err.message}`);
      }
      setRetryStatus(null);
      setSelectedIds([]);
      fetchLeads();
    }
  }

  function applyView(view) {
    setMany(view.filtersJson || {});
    setPage(1);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div>
      <h1 className="page-title">Lead Pipeline</h1>

      <KpiStrip filterParams={queryString} />
      <SavedViews currentFilters={filters} currentSort={filters.sort} onApply={applyView} />
      <FilterBar filters={filters} setFilter={setFilter} setMany={setMany} clearFilters={clearFilters} />

      <div className="export-row">
        <button className="btn" onClick={() => api.exportLeadsCsv(queryString, 'visible')}>Export CSV (visible)</button>
        <button className="btn" onClick={() => api.exportLeadsCsv(queryString, 'all')}>Export CSV (all fields)</button>
        <span className="filter-count">{total} leads</span>
      </div>

      {retryStatus && (
        <div className="retry-progress">Retrying… {retryStatus.done}/{retryStatus.total} ({retryStatus.errors} errors)</div>
      )}

      <BulkActionBar selectedIds={selectedIds} onAction={handleBulk} />

      <LeadsTable
        leads={leads}
        loading={loading}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        sort={filters.sort}
        onSort={s => setFilter('sort', s)}
        onOpenDetail={openDetail}
      />

      {totalPages > 1 && (
        <div className="pagination">
          <button className="page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
        </div>
      )}

      {detailLead && (
        <LeadDetailPanel
          lead={detailLead}
          detailData={detailData}
          onClose={closeDetail}
          onSavedNote={note => setDetailLead(s => s ? { ...s, manual_hook_note: note } : s)}
        />
      )}
    </div>
  );
}

async function runStreamedRetry(leadIds, stage, onEvent) {
  const r = await fetch('/api/leads/bulk/retry', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadIds, stage }),
  });
  if (r.status === 503) throw new Error('Bulk retry disabled (set BULK_RETRY_ENABLED=true on server)');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/^data:\s*/, '');
      buf = buf.slice(idx + 2);
      try { onEvent(JSON.parse(line)); } catch { /* ignore parse errors */ }
    }
  }
}
