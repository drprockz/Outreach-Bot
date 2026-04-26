import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatCard from '../components/StatCard';
import TechTerm from '../components/TechTerm';

const USD_TO_INR = 85;

function fmtPct(n) {
  if (n == null) return '—';
  return `${Number(n).toFixed(2)}%`;
}

// A reply counts as "needs action" if it's hot/schedule and not yet actioned.
// Falls back to "everything not actioned" if the category is null.
function needsAction(r) {
  if (r.actioned_at) return false;
  if (r.category === 'hot' || r.category === 'schedule') return true;
  return r.category == null;
}

export default function Today() {
  const [data, setData] = useState(null);
  const [replies, setReplies] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.overview().then(setData).catch(e => setError(`Failed to load overview: ${e.message}`));
    api.replies().then(r => setReplies((r?.replies || []).filter(needsAction).slice(0, 5))).catch(() => {});
  }, []);

  if (error) return <div className="page"><h1 className="page-title">Today</h1><div className="msg error">{error}</div></div>;
  if (!data) return <div className="page"><h1 className="page-title">Today</h1><div className="td-muted">Loading…</div></div>;

  const { metrics } = data;

  return (
    <div className="today-page">
      <header>
        <h1 className="page-title">Today</h1>
        <p className="muted">Pipeline at a glance plus anything waiting on you.</p>
      </header>

      <div className="stat-grid">
        <StatCard
          label="Leads discovered today"
          value={metrics.today?.leads_discovered || 0}
          color="var(--blue)"
        />
        <StatCard
          label="Emails sent today"
          value={metrics.today?.emails_sent || 0}
          color="var(--green)"
        />
        <StatCard
          label={<><TechTerm id="bounceRate">Bounce rate</TechTerm> today</>}
          value={fmtPct(metrics.bounceRateToday)}
          color={metrics.bounceRateToday > 2 ? 'var(--red)' : 'var(--green)'}
        />
        <StatCard
          label="Replies waiting"
          value={replies.length}
          color="var(--amber)"
        />
        <StatCard
          label="Hot replies (7d)"
          value={metrics.week?.replies_hot || 0}
          color="var(--red)"
        />
        <StatCard
          label="API spend (30d)"
          value={`$${(metrics.month?.total_api_cost_usd || 0).toFixed(2)}`}
          sub={`~₹${((metrics.month?.total_api_cost_usd || 0) * USD_TO_INR).toFixed(0)}`}
          color="var(--amber)"
        />
      </div>

      <div className="section-title" style={{ marginTop: 'var(--space-xl)' }}>
        Replies that need you
      </div>
      <div className="card">
        {replies.length === 0 ? (
          <p className="muted">Nothing waiting. Nice.</p>
        ) : (
          <ul className="today-reply-list">
            {replies.map(r => (
              <li key={r.id}>
                <Link to={`/outreach/replies#${r.id}`}>
                  <strong>{r.contact_name || r.contact_email || 'Unknown sender'}</strong>
                  {r.business_name && <span className="muted"> · {r.business_name}</span>}
                  {r.category && <span className={`badge ${r.category === 'hot' ? 'badge-red' : 'badge-amber'}`} style={{ marginLeft: 8 }}>{r.category}</span>}
                  <div className="td-dim" style={{ fontSize: 11 }}>
                    {r.received_at ? new Date(r.received_at).toLocaleString() : ''}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
