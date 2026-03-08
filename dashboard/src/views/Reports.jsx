import React, { useEffect, useState } from 'react';
import { fetchReports, fetchReport } from '../api.js';

export default function Reports() {
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [html, setHtml] = useState('');
  const [hoveredDate, setHoveredDate] = useState(null);

  useEffect(() => { fetchReports().then(setList); }, []);

  const loadReport = async (date) => {
    setSelected(date);
    const report = await fetchReport(date);
    setHtml(report.html_body || '<p>No report content</p>');
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Reports</h1>
        <p style={{ fontSize: 13, color: '#52525b', marginTop: 4 }}>
          Daily outreach performance reports
        </p>
      </div>

      <div style={{ display: 'flex', gap: 20, height: 'calc(100vh - 160px)' }}>
        <div style={{
          width: 280,
          background: 'linear-gradient(180deg, #0f0f0f 0%, #0a0a0a 100%)',
          border: '1px solid #ffffff08', borderRadius: 12,
          overflowY: 'auto', padding: 10,
        }}>
          {list.map((r) => {
            const active = selected === r.report_date;
            const hovered = hoveredDate === r.report_date;
            return (
              <div
                key={r.report_date}
                onClick={() => loadReport(r.report_date)}
                onMouseEnter={() => setHoveredDate(r.report_date)}
                onMouseLeave={() => setHoveredDate(null)}
                style={{
                  padding: '12px 14px', borderRadius: 10,
                  cursor: 'pointer', fontSize: 12, marginBottom: 4,
                  background: active ? '#ffffff0a' : hovered ? '#ffffff05' : 'transparent',
                  border: active ? '1px solid #6366f130' : '1px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontWeight: 600, color: active ? '#fafafa' : '#a1a1aa' }}>{r.report_date}</div>
                <div style={{ color: '#52525b', fontSize: 11, marginTop: 4 }}>
                  {r.sent_count} sent &middot; {r.reply_count} replies &middot; {r.hot_count} hot
                </div>
              </div>
            );
          })}

          {list.length === 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: 40, color: '#52525b',
              fontSize: 13, textAlign: 'center', gap: 12,
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>No reports generated yet</span>
            </div>
          )}
        </div>

        <div style={{ flex: 1 }}>
          {html ? (
            <div style={{
              background: '#fff', borderRadius: 12, overflow: 'hidden',
              height: '100%', border: '1px solid #ffffff08',
              boxShadow: '0 2px 8px #00000040',
            }}>
              <iframe
                srcDoc={html}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Report"
              />
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%',
              background: 'linear-gradient(135deg, #0f0f0f 0%, #0a0a0a 100%)',
              borderRadius: 12, border: '1px solid #ffffff08',
              color: '#52525b', gap: 12,
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round">
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span style={{ fontSize: 14 }}>Select a report to preview</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
