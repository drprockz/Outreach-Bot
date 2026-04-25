import React, { useState } from 'react';

const RETRY_STAGES = [
  'verify_email',
  'regen_hook',
  'regen_body',
  'rescore_icp',
  'reextract',
  'rejudge',
];

export default function BulkActionBar({ selectedIds, onAction }) {
  const [retryOpen, setRetryOpen] = useState(false);
  if (selectedIds.length === 0) return null;
  return (
    <div className="bulk-bar">
      <span className="bulk-count">{selectedIds.length} selected</span>
      <button className="btn" onClick={() => onAction({ kind: 'status', action: 'nurture' })}>
        Mark as nurture
      </button>
      <button className="btn" onClick={() => onAction({ kind: 'status', action: 'unsubscribed' })}>
        Mark as unsubscribed
      </button>
      <button className="btn" onClick={() => onAction({ kind: 'status', action: 'reject' })}>
        Add to reject list
      </button>
      <button className="btn" onClick={() => onAction({ kind: 'status', action: 'requeue' })}>
        Send back to ready
      </button>
      <div className="retry-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
        <button className="btn" onClick={() => setRetryOpen(o => !o)}>Retry ▾</button>
        {retryOpen && (
          <ul
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              listStyle: 'none',
              padding: 4,
              margin: 0,
              zIndex: 10,
              minWidth: 160,
            }}
          >
            {RETRY_STAGES.map(s => (
              <li key={s}>
                <button
                  className="btn"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => {
                    onAction({ kind: 'retry', stage: s });
                    setRetryOpen(false);
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
