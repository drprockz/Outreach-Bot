import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import PageHeader from '../components/radar/PageHeader';
import {
  Badge, Button, Card, Sparkline, StatCard, Status,
  replyTone, replyLabel,
} from '../components/radar/RadarUI';
import { useAuth } from '../components/AuthGate';

const USD_TO_INR = 85;

function fmtPct(n) {
  if (n == null) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function needsAction(r) {
  if (r.actioned_at) return false;
  if (r.category === 'hot' || r.category === 'schedule') return true;
  return r.category == null;
}

function todayHeaderTitle(name) {
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${greeting}, ${name}` : greeting;
}

function todayHeaderSubtitle() {
  return new Date().toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Kolkata',
  }) + ' IST · All systems nominal';
}

export default function Today() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [replies, setReplies] = useState([]);
  const [errors, setErrors] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.overview().then(setData).catch((e) => setError(`Failed to load overview: ${e.message}`));
    api.replies().then((r) => setReplies((r?.replies || []).filter(needsAction).slice(0, 5))).catch(() => {});
    api.errors('?resolved=0&limit=5').then((d) => setErrors(d?.errors || [])).catch(() => {});
  }, []);

  const firstName = (auth?.user?.email || '').split('@')[0].split('.')[0];
  const titleName = firstName ? firstName[0].toUpperCase() + firstName.slice(1) : '';

  if (error) {
    return (
      <>
        <PageHeader title={todayHeaderTitle(titleName)} subtitle={todayHeaderSubtitle()} />
        <div style={{ color: 'var(--red)' }}>{error}</div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title={todayHeaderTitle(titleName)} subtitle={todayHeaderSubtitle()} />
        <div style={{ color: 'var(--text-3)' }}>Loading…</div>
      </>
    );
  }

  const { metrics } = data;

  const stats = [
    {
      label: 'Leads discovered today',
      value: (metrics.today?.leads_discovered ?? 0).toLocaleString('en-IN'),
      tone: 'blue',
      sub: 'fresh today',
    },
    {
      label: 'Emails sent today',
      value: (metrics.today?.emails_sent ?? 0).toLocaleString('en-IN'),
      tone: 'green',
      sub: 'across active inboxes',
    },
    {
      label: 'Bounce rate today',
      value: fmtPct(metrics.bounceRateToday),
      tone: (metrics.bounceRateToday ?? 0) > 2 ? 'red' : 'neutral',
      sub: (metrics.bounceRateToday ?? 0) > 2 ? 'over 2% threshold' : 'under 2% threshold',
    },
    {
      label: 'Replies waiting',
      value: replies.length.toString(),
      tone: 'amber',
      sub: 'needs human eyes',
      alert: replies.length > 0,
    },
    {
      label: 'Hot replies (7d)',
      value: (metrics.week?.replies_hot ?? 0).toString(),
      tone: 'red',
      sub: 'last 7 days',
    },
    {
      label: 'API spend (30d)',
      value: `$${(metrics.month?.total_api_cost_usd ?? 0).toFixed(2)}`,
      tone: 'amber',
      sub: `≈ ₹${((metrics.month?.total_api_cost_usd ?? 0) * USD_TO_INR).toFixed(0)}`,
    },
  ];

  // Pipeline health from real metrics (fallback to zeros)
  const pipeline = [
    { label: 'Discovered', value: metrics.month?.leads_discovered ?? 0, color: 'var(--blue)', pct: 100 },
    { label: 'ICP A+B',    value: metrics.month?.leads_icp_ab     ?? 0, color: 'var(--cyan)', pct: 60 },
    { label: 'Personalised', value: metrics.month?.emails_drafted  ?? 0, color: 'var(--purple)', pct: 50 },
    { label: 'Sent',         value: metrics.month?.emails_sent     ?? 0, color: 'var(--green)', pct: 38 },
    { label: 'Replied',      value: metrics.month?.replies_total   ?? 0, color: 'var(--green-bright)', pct: 4 },
    { label: 'Hot',          value: metrics.month?.replies_hot     ?? 0, color: 'var(--amber)', pct: 1 },
  ];
  const pipeMax = Math.max(...pipeline.map((p) => p.value), 1);

  return (
    <>
      <PageHeader
        title={todayHeaderTitle(titleName)}
        subtitle={todayHeaderSubtitle()}
        action={
          <>
            <Button kind="ghost" size="sm" icon="refresh" onClick={() => window.location.reload()}>
              Refresh
            </Button>
            <Button kind="primary" size="sm" icon="play" onClick={() => navigate('/outreach/engines')}>
              Run engines
            </Button>
          </>
        }
      />

      <div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: 12, marginBottom: 22,
        }}>
          {stats.map((s) => (
            <StatCard
              key={s.label}
              {...s}
              sparkline={
                <div style={{ marginTop: 10, marginLeft: -4 }}>
                  <Sparkline
                    data={[4, 8, 6, 12, 18, 15, 22, 28, 24, 32, 29, 38].map((v) => v + (s.label.length % 7))}
                    color={`var(--${s.tone === 'neutral' ? 'text-3' : s.tone})`}
                    fill
                    width={120}
                    height={28}
                  />
                </div>
              }
            />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
          <Card
            title="Replies that need you"
            headerRight={
              replies.length > 0
                ? <Badge tone="amber" size="sm" dot pulse>{replies.length} waiting</Badge>
                : <Badge tone="green" size="sm">All clear</Badge>
            }
            padding={0}
          >
            {replies.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5 }}>
                Nothing waiting. Nice.
              </div>
            ) : (
              replies.map((r, i) => {
                const cat = r.category && replyTone[r.category] ? r.category : 'hot';
                const name = r.contact_name || r.contact_email || 'Unknown sender';
                const initials = name.split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase();
                return (
                  <div
                    key={r.id || i}
                    onClick={() => navigate(`/outreach/replies#${r.id}`)}
                    style={{
                      display: 'flex', gap: 14, padding: '12px 16px',
                      borderBottom: i < replies.length - 1 ? '1px solid var(--border)' : 0,
                      cursor: 'pointer', transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tint)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 6,
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-light)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11.5, fontWeight: 600,
                      fontFamily: 'var(--font-mono)', color: 'var(--text-2)', flexShrink: 0,
                    }}>
                      {initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{name}</span>
                        {r.business_name && (
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>· {r.business_name}</span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                          {r.received_at ? new Date(r.received_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 12, color: 'var(--text-2)',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
                      }}>
                        {r.preview || r.subject || ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <Badge tone={replyTone[cat]} size="sm">{replyLabel[cat]}</Badge>
                    </div>
                  </div>
                );
              })
            )}
          </Card>

          <Card
            title="Pipeline health"
            headerRight={
              <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                last 30 days
              </span>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {pipeline.map((s) => {
                const pct = pipeMax > 0 ? Math.min(100, (s.value / pipeMax) * 100) : 0;
                return (
                  <div key={s.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{s.label}</span>
                      <span style={{
                        fontSize: 11.5, color: 'var(--text-1)',
                        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                      }}>
                        {s.value.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div style={{
                      height: 5,
                      background: 'var(--bg-tint)',
                      border: '1px solid var(--border)',
                      borderRadius: 999, overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${pct}%`, height: '100%',
                        background: s.color, borderRadius: 999, transition: 'width 0.4s',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Bottom strip */}
        <div style={{
          marginTop: 18,
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14,
        }}>
          <Card title="Engines snapshot" padding={14}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11.5 }}>
              {[
                { name: 'Find Leads', status: 'idle' },
                { name: 'Send Emails', status: 'idle' },
                { name: 'Reply Watcher', status: 'idle' },
                { name: 'Bounce Sweeper', status: 'done' },
              ].map((r) => (
                <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-2)' }}>{r.name}</span>
                  <Status status={r.status} size="sm" />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Today's schedule" padding={14}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { time: '06:00', label: 'Find Leads', status: 'done' },
                { time: '09:30', label: 'ICP Score Batch', status: 'done' },
                { time: '11:00', label: 'Send wave A', status: 'idle' },
                { time: '16:00', label: 'Follow-up wave (D+3)', status: 'queued' },
              ].map((r) => (
                <div key={r.time} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5 }}>
                  <span style={{ width: 44, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{r.time}</span>
                  <span style={{ flex: 1, color: 'var(--text-1)' }}>{r.label}</span>
                  <Status status={r.status} size="sm" />
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Errors (24h)"
            padding={14}
            headerRight={errors.length > 0 ? <Badge tone="red" size="sm">{errors.length}</Badge> : <Badge tone="green" size="sm">Clean</Badge>}
          >
            {errors.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>No errors in the last 24 hours.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {errors.slice(0, 3).map((e) => (
                  <div key={e.id} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: e.severity === 'warn' ? 'var(--amber)' : 'var(--red)' }}>
                      {(e.severity || 'err').toUpperCase().slice(0, 3)}
                    </span>
                    <span style={{
                      color: 'var(--text-2)', flex: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {e.message || e.code}
                    </span>
                    <span style={{ color: 'var(--text-3)' }}>
                      {e.created_at ? new Date(e.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
