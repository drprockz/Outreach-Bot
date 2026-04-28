import React, { useEffect, useState } from 'react';
import { api } from '../api';

const catBadge = {
  hot: 'badge-red', schedule: 'badge-blue', soft_no: 'badge-amber',
  unsubscribe: 'badge-muted', ooo: 'badge-orange', other: 'badge-muted',
};

export default function Replies() {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);

  function fetchReplies() {
    api.replies().then(d => {
      setReplies(d?.replies || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchReplies(); }, []);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      api.replies().then(d => setReplies(d?.replies || [])).catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, []);

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
        <h1 className="page-title">Reply Feed</h1>
        <div className="loading">Loading replies...</div>
      </div>
    );
  }

  function renderSentiment(score) {
    if (!score) return null;
    return (
      <div className="sentiment">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`sentiment-dot ${i <= score ? 'filled' : ''}`} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Reply Feed</h1>
      <div className="page-subtitle">{replies.length} replies total — auto-refreshes every 60s</div>

      {replies.length === 0 ? (
        <div className="empty-state">No replies received yet.</div>
      ) : (
        replies.map((reply) => (
          <div key={reply.id} className="reply-card fade-in" data-cat={reply.category}>
            <div className="reply-header">
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: '13px' }}>
                  {reply.contact_name || reply.business_name || 'Unknown'}
                </span>
                <span className="td-muted" style={{ marginLeft: '12px', fontSize: '11px' }}>
                  {reply.contact_email || ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={`badge badge-lg ${catBadge[reply.category] || 'badge-muted'}`}>
                  {reply.category || 'other'}
                </span>
                {renderSentiment(reply.sentiment_score)}
              </div>
            </div>

            <div className="reply-preview">{reply.raw_text || '(no content)'}</div>

            <div className="reply-meta">
              <span className="td-dim">
                {reply.received_at ? new Date(reply.received_at).toLocaleString() : '-'}
              </span>
              {reply.inbox_received_at && (
                <span className="td-dim">Inbox: {reply.inbox_received_at}</span>
              )}
              {reply.actioned_at ? (
                <span className="badge badge-green" style={{ fontSize: '9px' }}>
                  {reply.action_taken || 'ACTIONED'}
                </span>
              ) : (
                <span className="badge badge-amber" style={{ fontSize: '9px' }}>PENDING</span>
              )}
            </div>

            {!reply.actioned_at && (
              <div className="reply-actions">
                <button className="btn btn-green" onClick={() => handleAction(reply.id, 'booked_call')}>Booked Call</button>
                <button className="btn btn-blue" onClick={() => handleAction(reply.id, 'replied')}>Replied</button>
                <button className="btn btn-muted" onClick={() => handleAction(reply.id, 'ignored')}>Ignore</button>
                <button className="btn btn-red" onClick={() => handleReject(reply.id)}>Reject</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
