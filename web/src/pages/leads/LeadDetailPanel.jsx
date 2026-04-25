import React, { useState } from 'react';
import { api } from '../../api';
import { parseJson, statusBadge, LinkedInLinks } from './leadsTableHelpers';

const DEFAULT_WEIGHTS = { firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 };

function ChipList({ label, json, variant }) {
  let arr;
  try { arr = JSON.parse(json); } catch { arr = []; }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return (
    <div className="chip-list">
      <strong>{label}:</strong>
      {arr.map((s, i) => (
        <span key={i} className={`icp-chip icp-chip-${variant}`}>{s}</span>
      ))}
    </div>
  );
}

function ManualHookNoteEditor({ leadId, initial, onSaved }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState(null);

  async function handleBlur() {
    if (value === initial) return;
    setSaving(true);
    setError(null);
    try {
      await api.patchLead(leadId, { manualHookNote: value });
      setSavedAt(Date.now());
      onSaved?.(value);
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const showSaved = savedAt && Date.now() - savedAt < 3000;

  return (
    <div>
      <textarea
        className="input"
        rows={3}
        style={{ width: '100%', fontFamily: 'inherit' }}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add a hint for the next hook regenerate (e.g. 'noticed they switched payment provider — angle on US expansion?')"
      />
      <div className="td-dim" style={{ marginTop: '4px', fontSize: '11px' }}>
        {saving && 'Saving…'}
        {!saving && showSaved && <span style={{ color: 'var(--green)' }}>Saved</span>}
        {error && <span style={{ color: 'var(--red)' }}>Error: {error}</span>}
      </div>
    </div>
  );
}

export default function LeadDetailPanel({ lead, detailData, onClose, onSavedNote }) {
  if (!lead) return null;
  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="detail-panel">
        <button className="detail-close" onClick={onClose}>✕</button>
        <h2 className="detail-title">{lead.business_name || 'Lead Detail'}</h2>

        <div className="detail-label">Website</div>
        <div className="detail-value">
          {lead.website_url ? <a href={lead.website_url} target="_blank" rel="noopener noreferrer">{lead.website_url}</a> : '-'}
        </div>

        <div className="detail-label">Category</div>
        <div className="detail-value">{lead.category || '-'}</div>

        <div className="detail-label">City / Country</div>
        <div className="detail-value">{lead.city || '-'}{lead.country ? `, ${lead.country}` : ''}</div>

        <div className="detail-label">Owner</div>
        <div className="detail-value">{lead.owner_name || '-'}{lead.owner_role ? ` (${lead.owner_role})` : ''}</div>

        <div className="detail-label">Contact</div>
        <div className="detail-value">
          {lead.contact_name || '-'} — {lead.contact_email || '-'}
          {lead.contact_confidence && <span className="td-dim" style={{ marginLeft: '8px' }}>({lead.contact_confidence})</span>}
        </div>

        <div className="detail-label">Email Status</div>
        <div className="detail-value">{lead.email_status || '-'}</div>

        <div className="detail-label">Tech Stack</div>
        <div className="detail-value">
          {parseJson(lead.tech_stack).map((t, i) => (
            <span key={i} className="badge badge-outline" style={{ marginRight: '4px', marginBottom: '4px' }}>{t}</span>
          ))}
          {parseJson(lead.tech_stack).length === 0 && '-'}
        </div>

        <div className="detail-label">Website Quality Score</div>
        <div className="detail-value">{lead.website_quality_score ?? '-'} / 10</div>

        <div className="detail-label">Judge Reason</div>
        <div className="detail-value">{lead.judge_reason || '-'}</div>

        <div className="detail-label">Website Problems</div>
        <div className="detail-value">
          {parseJson(lead.website_problems).length > 0
            ? parseJson(lead.website_problems).map((p, i) => <div key={i} className="td-muted">- {p}</div>)
            : '-'}
        </div>

        <div className="detail-label">Business Signals</div>
        <div className="detail-value">
          {parseJson(lead.business_signals).length > 0
            ? parseJson(lead.business_signals).map((s, i) => <div key={i} className="td-muted">- {s}</div>)
            : '-'}
        </div>

        <div className="detail-label">ICP Score / Priority</div>
        <div className="detail-value">
          <div className="icp-details">
            <div><strong>Score:</strong> {lead.icp_score ?? '-'} / 100</div>
            {lead.icp_breakdown && (
              <div className="icp-breakdown">
                <strong>Breakdown</strong>
                <small className="td-muted"> (per-factor evidence; may not sum exactly to score)</small>
                {(() => {
                  let b;
                  try { b = JSON.parse(lead.icp_breakdown); } catch { b = null; }
                  if (!b) return null;
                  return Object.entries(b).map(([k, v]) => {
                    const max = DEFAULT_WEIGHTS[k] || 20;
                    const pct = Math.min(100, (v / max) * 100);
                    return (
                      <div key={k} className="breakdown-row">
                        <span className="label">{k}</span>
                        <span className="bar" style={{ width: `${pct}%` }} />
                        <span className="val">{v}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
            {lead.icp_key_matches && (
              <ChipList label="Matches" json={lead.icp_key_matches} variant="match" />
            )}
            {lead.icp_key_gaps && (
              <ChipList label="Gaps" json={lead.icp_key_gaps} variant="gap" />
            )}
            {lead.icp_disqualifiers && (
              <ChipList label="Disqualifiers" json={lead.icp_disqualifiers} variant="dq" />
            )}
          </div>
          {lead.icp_reason && <div className="td-dim" style={{ marginTop: '4px' }}>{lead.icp_reason}</div>}
        </div>

        <div className="detail-label">Status</div>
        <div className="detail-value">
          <span className={`badge ${statusBadge[lead.status] || 'badge-muted'}`}>{lead.status}</span>
        </div>

        <div className="detail-label">LinkedIn</div>
        <div className="detail-value">
          <LinkedInLinks lead={lead} />
          {!lead.dm_linkedin_url && !lead.company_linkedin_url && !lead.founder_linkedin_url && '-'}
        </div>

        <div className="detail-label">Manual hook note <span className="td-dim" style={{ fontWeight: 'normal' }}>(operator hint for next regenerate)</span></div>
        <div className="detail-value">
          <ManualHookNoteEditor
            key={`hook-note-${lead.id}`}
            leadId={lead.id}
            initial={lead.manual_hook_note || ''}
            onSaved={onSavedNote}
          />
        </div>

        {detailData?.signals && detailData.signals.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">Recent Signals (top {detailData.signals.length})</div>
            {detailData.signals.map((s, i) => (
              <div key={i} className="detail-signal-row">
                <span className="badge badge-outline" style={{ marginRight: '6px' }}>{s.source}</span>
                <span className="badge badge-blue" style={{ marginRight: '6px' }}>{s.signal_type}</span>
                <span className="td-muted">conf {s.confidence?.toFixed(2)}</span>
                <div style={{ marginTop: '2px' }}>
                  {s.url
                    ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.headline || s.url}</a>
                    : <span>{s.headline}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {detailData?.emails && detailData.emails.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">Emails Sent</div>
            {detailData.emails.map((em, i) => (
              <div key={i} className="detail-email-card">
                <div style={{ color: 'var(--blue)', marginBottom: '4px', fontSize: '11px' }}>Step {em.sequence_step}: {em.subject || '(no subject)'}</div>
                <div className="td-dim" style={{ marginBottom: '4px' }}>{em.sent_at ? new Date(em.sent_at).toLocaleString() : 'pending'} via {em.inbox_used || '-'}</div>
                <div className="td-muted" style={{ fontSize: '11px', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'hidden' }}>{em.body || ''}</div>
              </div>
            ))}
          </div>
        )}

        {detailData?.replies && detailData.replies.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">Replies</div>
            {detailData.replies.map((r, i) => (
              <div key={i} className="detail-reply-card">
                <div style={{ color: 'var(--red)', marginBottom: '4px', fontSize: '11px' }}>{r.category || 'other'} — {r.received_at ? new Date(r.received_at).toLocaleString() : '-'}</div>
                <div className="td-muted" style={{ fontSize: '11px', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'hidden' }}>{r.raw_text || ''}</div>
              </div>
            ))}
          </div>
        )}

        {detailData?.sequence && (
          <div className="detail-section">
            <div className="detail-section-title">Sequence State</div>
            <div className="detail-value">
              Step: {detailData.sequence.current_step} | Status: {detailData.sequence.status} | Next: {detailData.sequence.next_send_date || '-'}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
