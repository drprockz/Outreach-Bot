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

export default function ReplyFeed() {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.replies().then(d => {
      setReplies(d?.replies || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1 style={pageTitle}>Reply Feed</h1>
        <div style={emptyState}>Loading replies...</div>
      </div>
    );
  }

  function getHighlightStyle(classification) {
    if (classification === 'hot') return { borderLeft: '3px solid #f87171', background: '#f8717108' };
    if (classification === 'schedule') return { borderLeft: '3px solid #60a5fa', background: '#60a5fa08' };
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
          const cc = classificationColors[reply.category || reply.classification] || classificationColors.other;
          return (
            <div key={reply.id} style={{ ...cardStyle, ...getHighlightStyle(reply.category || reply.classification) }}>
              <div style={headerRow}>
                <div>
                  <span style={nameStyle}>{reply.contact_name || reply.company || 'Unknown'}</span>
                  <span style={{ ...emailStyle, marginLeft: '12px' }}>{reply.contact_email || ''}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ ...badgeBase, background: cc.bg, color: cc.color }}>
                    {reply.category || reply.classification || 'other'}
                  </span>
                  {renderSentiment(reply.sentiment_score)}
                </div>
              </div>
              <div style={previewStyle}>
                {reply.raw_text || reply.body_preview || '(no content)'}
              </div>
              <div style={metaRow}>
                <span style={timeStyle}>
                  {reply.received_at ? new Date(reply.received_at).toLocaleString() : '-'}
                </span>
                {reply.inbox_received_at && (
                  <span style={timeStyle}>Inbox: {reply.inbox_received_at}</span>
                )}
                {reply.actioned_at ? (
                  <span style={{ ...badgeBase, background: '#4ade8020', color: '#4ade80', fontSize: '9px' }}>ACTIONED</span>
                ) : (
                  <span style={{ ...badgeBase, background: '#facc1520', color: '#facc15', fontSize: '9px' }}>PENDING</span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
