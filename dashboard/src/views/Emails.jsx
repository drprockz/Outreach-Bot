import React, { useEffect, useState } from 'react';
import { fetchEmails } from '../api.js';
import Badge from '../components/Badge.jsx';

const SEQ_LABELS = { 1: 'Cold', 2: 'Day 3', 3: 'Day 7', 4: 'Day 14' };

export default function Emails() {
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [hoveredRow, setHoveredRow] = useState(null);
  const limit = 20;

  useEffect(() => {
    fetchEmails(page, limit).then((d) => {
      setEmails(d.emails);
      setTotal(d.total);
    });
  }, [page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Sent Emails</h1>
        <p style={{ fontSize: 13, color: '#52525b', marginTop: 4 }}>
          Track all outgoing emails and sequences
        </p>
      </div>

      <div style={{
        background: 'linear-gradient(135deg, #0f0f0f 0%, #0a0a0a 100%)',
        border: '1px solid #ffffff08', borderRadius: 12, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Lead', 'Subject', 'Seq', 'Status', 'Sent'].map((h) => (
                <th key={h} style={{
                  textAlign: 'left', padding: '14px 16px',
                  borderBottom: '1px solid #ffffff0f',
                  color: '#71717a', fontWeight: 600, fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: 1,
                  background: '#0a0a0a',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => (
              <React.Fragment key={e.id}>
                <tr
                  style={{
                    cursor: 'pointer',
                    background: hoveredRow === e.id ? '#ffffff04' : 'transparent',
                    transition: 'background 0.15s ease',
                  }}
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  onMouseEnter={() => setHoveredRow(e.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid #ffffff06' }}>
                    <div style={{ fontWeight: 600, color: '#fafafa' }}>{e.name}</div>
                    <div style={{ color: '#52525b', fontSize: 11, marginTop: 2 }}>{e.company}</div>
                  </td>
                  <td style={{
                    padding: '12px 16px', borderBottom: '1px solid #ffffff06',
                    maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', color: '#a1a1aa',
                  }}>
                    {e.subject}
                  </td>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid #ffffff06', color: '#71717a' }}>
                    {SEQ_LABELS[e.sequence] || e.sequence}
                  </td>
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid #ffffff06' }}>
                    <Badge status={e.status} />
                  </td>
                  <td style={{
                    padding: '12px 16px', borderBottom: '1px solid #ffffff06',
                    color: '#71717a', fontFamily: "'IBM Plex Mono', monospace",
                  }}>
                    {e.sent_at?.slice(0, 10) || '\u2014'}
                  </td>
                </tr>
                {expanded === e.id && (
                  <tr>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <div style={{
                        background: '#0a0a0a', borderTop: '1px solid #ffffff08',
                        padding: 24, fontSize: 13, lineHeight: 1.7,
                        whiteSpace: 'pre-wrap', color: '#a1a1aa',
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}>
                        <div style={{ color: '#6366f1', fontWeight: 600, marginBottom: 8 }}>
                          To: {e.lead_email}
                        </div>
                        <div style={{ color: '#71717a', marginBottom: 16 }}>
                          Subject: {e.subject}
                        </div>
                        {e.body}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {emails.length === 0 && (
          <div style={{
            padding: 60, textAlign: 'center', color: '#52525b', gap: 12,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
              stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span style={{ fontSize: 14 }}>No emails sent yet</span>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'center', alignItems: 'center' }}>
          <button
            style={{
              padding: '8px 20px', borderRadius: 8,
              border: '1px solid #ffffff10',
              background: page <= 1 ? '#0a0a0a' : '#ffffff06',
              color: page <= 1 ? '#3f3f46' : '#a1a1aa',
              fontSize: 12, fontWeight: 500, cursor: page <= 1 ? 'default' : 'pointer',
              fontFamily: "'Inter', sans-serif",
              transition: 'all 0.15s ease',
            }}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >Prev</button>
          <span style={{
            color: '#52525b', fontSize: 12, lineHeight: '36px',
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            {page} / {totalPages}
          </span>
          <button
            style={{
              padding: '8px 20px', borderRadius: 8,
              border: '1px solid #ffffff10',
              background: page >= totalPages ? '#0a0a0a' : '#ffffff06',
              color: page >= totalPages ? '#3f3f46' : '#a1a1aa',
              fontSize: 12, fontWeight: 500, cursor: page >= totalPages ? 'default' : 'pointer',
              fontFamily: "'Inter', sans-serif",
              transition: 'all 0.15s ease',
            }}
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages}
          >Next</button>
        </div>
      )}
    </div>
  );
}
