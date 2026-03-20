import React, { useEffect, useState } from 'react';
import { api } from '../api';

const pageTitle = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#e0e0e0',
  marginBottom: '24px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const cardStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '16px 20px',
  marginBottom: '8px',
  transition: 'border-color 0.15s',
};

const headerRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '8px',
};

const nameStyle = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#e0e0e0',
  fontFamily: 'IBM Plex Mono, monospace',
};

const emailStyle = {
  fontSize: '11px',
  color: '#888',
  fontFamily: 'IBM Plex Mono, monospace',
};

const timeStyle = {
  fontSize: '10px',
  color: '#555',
  fontFamily: 'IBM Plex Mono, monospace',
};

const previewStyle = {
  fontSize: '12px',
  color: '#aaa',
  fontFamily: 'IBM Plex Mono, monospace',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflow: 'hidden',
  maxHeight: '60px',
  textOverflow: 'ellipsis',
};

const badgeBase = {
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  textTransform: 'uppercase',
};

const classificationColors = {
  hot:         { bg: '#f8717130', color: '#f87171', border: '#f8717150' },
  schedule:    { bg: '#60a5fa30', color: '#60a5fa', border: '#60a5fa50' },
  soft_no:     { bg: '#facc1530', color: '#facc15', border: '#facc1550' },
  unsubscribe: { bg: '#88888830', color: '#888',    border: '#88888850' },
  ooo:         { bg: '#fb923c30', color: '#fb923c', border: '#fb923c50' },
  other:       { bg: '#55555530', color: '#555',    border: '#55555550' },
};

const sentimentBar = {
  display: 'flex',
  gap: '2px',
  alignItems: 'center',
  marginLeft: '8px',
};

const emptyState = {
  textAlign: 'center',
  color: '#555',
  fontSize: '13px',
  fontFamily: 'IBM Plex Mono, monospace',
  padding: '60px 20px',
};

const metaRow = {
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
  marginTop: '8px',
};

const actionBtnStyle = {
  padding: '4px 10px',
  border: '1px solid',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  cursor: 'pointer',
  transition: 'background 0.15s',
  marginRight: '6px',
};

export default function ReplyFeed() {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);

  function fetchReplies() {
    api.replies().then(d => {
      setReplies(d?.replies || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchReplies(); }, []);

  async function handleAction(id, action) {
    await api.replyAction(id, action);
    fetchReplies();
  }

  async function handleReject(id) {
    if (!window.confirm('Add this sender to the reject list permanently?')) return;
    await api.replyReject(id);
    fetchReplies();
  }

  if (loading) {
    return (
      <div>
        <h1 style={pageTitle}>Reply Feed</h1>
        <div style={emptyState}>Loading replies...</div>
      </div>
    );
  }

  function getHighlightStyle(cat) {
    if (cat === 'hot') return { borderLeft: '3px solid #f87171', background: '#f8717108' };
    if (cat === 'schedule') return { borderLeft: '3px solid #60a5fa', background: '#60a5fa08' };
    return { borderLeft: '3px solid transparent' };
  }

  function renderSentiment(score) {
    if (!score) return null;
    const dots = [];
    for (let i = 1; i <= 5; i++) {
      dots.push(
        <div key={i} style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: i <= score ? '#4ade80' : '#333',
        }} />
      );
    }
    return <div style={sentimentBar}>{dots}</div>;
  }

  return (
    <div>
      <h1 style={pageTitle}>Reply Feed</h1>
      <div style={{ fontSize: '11px', color: '#555', marginBottom: '16px', fontFamily: 'IBM Plex Mono, monospace' }}>
        {replies.length} replies total
      </div>

      {replies.length === 0 ? (
        <div style={emptyState}>No replies received yet.</div>
      ) : (
        replies.map((reply) => {
          const cc = classificationColors[reply.category] || classificationColors.other;
          return (
            <div key={reply.id} style={{ ...cardStyle, ...getHighlightStyle(reply.category) }}>
              <div style={headerRow}>
                <div>
                  <span style={nameStyle}>{reply.contact_name || reply.business_name || 'Unknown'}</span>
                  <span style={{ ...emailStyle, marginLeft: '12px' }}>{reply.contact_email || ''}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ ...badgeBase, background: cc.bg, color: cc.color }}>
                    {reply.category || 'other'}
                  </span>
                  {renderSentiment(reply.sentiment_score)}
                </div>
              </div>
              <div style={previewStyle}>
                {reply.raw_text || '(no content)'}
              </div>
              <div style={metaRow}>
                <span style={timeStyle}>
                  {reply.received_at ? new Date(reply.received_at).toLocaleString() : '-'}
                </span>
                {reply.inbox_received_at && (
                  <span style={timeStyle}>Inbox: {reply.inbox_received_at}</span>
                )}
                {reply.actioned_at ? (
                  <span style={{ ...badgeBase, background: '#4ade8020', color: '#4ade80', fontSize: '9px' }}>
                    {reply.action_taken || 'ACTIONED'}
                  </span>
                ) : (
                  <span style={{ ...badgeBase, background: '#facc1520', color: '#facc15', fontSize: '9px' }}>PENDING</span>
                )}
              </div>
              {!reply.actioned_at && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                  <button
                    onClick={() => handleAction(reply.id, 'booked_call')}
                    style={{ ...actionBtnStyle, background: '#4ade8015', borderColor: '#4ade8050', color: '#4ade80' }}
                  >
                    Booked Call
                  </button>
                  <button
                    onClick={() => handleAction(reply.id, 'replied')}
                    style={{ ...actionBtnStyle, background: '#60a5fa15', borderColor: '#60a5fa50', color: '#60a5fa' }}
                  >
                    Replied
                  </button>
                  <button
                    onClick={() => handleAction(reply.id, 'ignored')}
                    style={{ ...actionBtnStyle, background: '#88888815', borderColor: '#88888850', color: '#888' }}
                  >
                    Ignore
                  </button>
                  <button
                    onClick={() => handleReject(reply.id)}
                    style={{ ...actionBtnStyle, background: '#f8717115', borderColor: '#f8717150', color: '#f87171' }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
