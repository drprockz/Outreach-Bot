import React, { useEffect, useState } from 'react';
import { fetchPipeline, fetchPipelineLead, updateLeadStatus } from '../api.js';
import Badge from '../components/Badge.jsx';

const COLUMNS = ['cold', 'contacted', 'hot', 'schedule', 'soft', 'closed', 'rejected', 'dormant'];

const s = {
  board: { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 },
  col: {
    minWidth: 210, flex: '0 0 210px',
    background: 'linear-gradient(180deg, #0f0f0f 0%, #0a0a0a 100%)',
    border: '1px solid #ffffff08', borderRadius: 12,
    padding: 14, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto',
  },
  colTitle: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 14, padding: '0 4px',
  },
  colCount: {
    fontSize: 10, fontWeight: 700, color: '#52525b',
    background: '#ffffff08', padding: '2px 8px', borderRadius: 10,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  name: { fontWeight: 600, color: '#fafafa', fontSize: 12 },
  company: { color: '#71717a', fontSize: 11, marginTop: 2 },
  modal: {
    position: 'fixed', inset: 0, background: '#00000080',
    backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 100, animation: 'backdropFade 0.2s ease',
  },
  modalCard: {
    background: 'linear-gradient(135deg, #111111 0%, #0a0a0a 100%)',
    border: '1px solid #ffffff10', borderRadius: 16,
    padding: 36, width: 560, maxHeight: '80vh', overflowY: 'auto',
    animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    boxShadow: '0 24px 80px #00000080', position: 'relative',
  },
  closeBtn: {
    position: 'absolute', top: 16, right: 16,
    width: 32, height: 32, borderRadius: 8,
    background: '#ffffff08', border: '1px solid #ffffff10',
    color: '#71717a', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16,
  },
};

export default function Pipeline() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [hoveredCard, setHoveredCard] = useState(null);

  useEffect(() => { fetchPipeline().then(setData); }, []);

  const openDetail = async (leadId) => {
    setSelected(leadId);
    const d = await fetchPipelineLead(leadId);
    setDetail(d);
  };

  const changeStatus = async (leadId, status) => {
    await updateLeadStatus(leadId, status);
    setSelected(null);
    setDetail(null);
    fetchPipeline().then(setData);
  };

  if (!data) return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div className="skeleton" style={{ width: 120, height: 24, marginBottom: 24 }} />
      <div style={{ display: 'flex', gap: 12 }}>
        {[1,2,3,4,5,6,7,8].map(i => (
          <div key={i} className="skeleton" style={{ width: 210, height: 300, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Pipeline</h1>
        <p style={{ fontSize: 13, color: '#52525b', marginTop: 4 }}>
          Manage leads across your outreach funnel
        </p>
      </div>

      <div style={s.board}>
        {COLUMNS.map((status) => (
          <div key={status} style={s.col}>
            <div style={s.colTitle}>
              <span>{status}</span>
              <span style={s.colCount}>{(data[status] || []).length}</span>
            </div>
            {(data[status] || []).map((lead) => {
              const isHovered = hoveredCard === lead.lead_id;
              return (
                <div
                  key={lead.lead_id}
                  onMouseEnter={() => setHoveredCard(lead.lead_id)}
                  onMouseLeave={() => setHoveredCard(null)}
                  onClick={() => openDetail(lead.lead_id)}
                  style={{
                    background: isHovered ? '#141414' : '#0f0f0f',
                    border: `1px solid ${isHovered ? '#ffffff15' : '#ffffff08'}`,
                    borderRadius: 10, padding: 14, marginBottom: 8,
                    cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: isHovered ? 'translateY(-1px)' : 'translateY(0)',
                    boxShadow: isHovered ? '0 4px 12px #00000040' : 'none',
                  }}
                >
                  <div style={s.name}>{lead.name}</div>
                  <div style={s.company}>{lead.company}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {selected && detail && (
        <div style={s.modal} onClick={() => { setSelected(null); setDetail(null); }}>
          <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
            <button style={s.closeBtn} onClick={() => { setSelected(null); setDetail(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingRight: 32 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{detail.name}</div>
                <div style={{ color: '#71717a', fontSize: 13, marginTop: 2 }}>{detail.company}</div>
              </div>
              <Badge status={detail.pipeline_status} />
            </div>

            <div style={{
              fontSize: 12, color: '#71717a', marginBottom: 20,
              padding: '10px 14px', background: '#ffffff06',
              borderRadius: 8, border: '1px solid #ffffff08',
            }}>
              {detail.email} &middot; {detail.location} &middot; {detail.type}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 24 }}>
              {COLUMNS.filter((col) => col !== detail.pipeline_status).map((col) => (
                <button key={col} onClick={() => changeStatus(detail.id, col)} style={{
                  padding: '6px 14px', borderRadius: 100,
                  border: '1px solid #ffffff10', background: '#ffffff06',
                  color: '#a1a1aa', fontSize: 11, fontWeight: 500,
                  cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                  transition: 'all 0.15s ease', textTransform: 'capitalize',
                }}>
                  {col}
                </button>
              ))}
            </div>

            {detail.emails?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: '#6366f1', marginBottom: 10,
                  textTransform: 'uppercase', letterSpacing: 1,
                }}>Sent Emails</div>
                {detail.emails.map((e) => (
                  <div key={e.id} style={{
                    padding: 12, background: '#ffffff04',
                    border: '1px solid #ffffff08',
                    borderRadius: 8, marginBottom: 6, fontSize: 11,
                  }}>
                    <div style={{ color: '#71717a' }}>
                      Seq {e.sequence} &middot; {e.status} &middot; {e.sent_at || 'pending'}
                    </div>
                    <div style={{ color: '#a1a1aa', fontWeight: 600, marginTop: 4 }}>{e.subject}</div>
                  </div>
                ))}
              </div>
            )}

            {detail.replies?.length > 0 && (
              <div>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: '#86efac', marginBottom: 10,
                  textTransform: 'uppercase', letterSpacing: 1,
                }}>Replies</div>
                {detail.replies.map((r) => (
                  <div key={r.id} style={{
                    padding: 12, background: '#14532d10',
                    border: '1px solid #22c55e15',
                    borderRadius: 8, marginBottom: 6, fontSize: 11,
                  }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Badge status={r.classification} />
                      <span style={{ color: '#71717a' }}>{r.received_at}</span>
                    </div>
                    {r.summary && <div style={{ color: '#a1a1aa', marginTop: 6 }}>{r.summary}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
