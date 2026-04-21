import React, { useEffect, useState } from 'react';
import { api } from '../api';

function gaugeColor(value, warn, critical) {
  if (value >= critical) return 'var(--red)';
  if (value >= warn) return 'var(--amber)';
  return 'var(--green)';
}

const BLACKLIST_ZONES = ['dbl.spamhaus.org', 'b.barracudacentral.org', 'multi.surbl.org'];

export default function EmailHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mailTesterInput, setMailTesterInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.health().then(d => {
      setData(d);
      if (d?.mailTesterScore != null) setMailTesterInput(String(d.mailTesterScore));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function handleSaveMailTester() {
    const score = parseFloat(mailTesterInput);
    if (isNaN(score) || score < 0 || score > 10) return;
    setSaving(true);
    await api.updateMailTester(score);
    setSaving(false);
  }

  if (loading) return <div><h1 className="page-title">Health Monitor</h1><div className="loading">Loading health data...</div></div>;
  if (!data) return <div><h1 className="page-title">Health Monitor</h1><div className="error-state">Failed to load health data.</div></div>;

  const bounceColor = gaugeColor(data.bounceRate, 1.0, 2.0);
  const unsubColor = gaugeColor(data.unsubscribeRate, 0.5, 1.0);
  const listedZones = (() => {
    if (!data.blacklistZones) return [];
    try { return typeof data.blacklistZones === 'string' ? JSON.parse(data.blacklistZones) : data.blacklistZones; }
    catch { return []; }
  })();

  return (
    <div>
      <h1 className="page-title">Health Monitor</h1>

      {/* Gauges */}
      <div className="gauge-grid">
        <div className="gauge-card fade-in stagger-1">
          <div className="gauge-label">Bounce Rate (Today)</div>
          <div className="gauge-value" style={{ color: bounceColor }}>{data.bounceRate.toFixed(2)}%</div>
          <div className="gauge-bar-track">
            <div className="gauge-bar-fill" style={{ width: `${Math.min(data.bounceRate / 4 * 100, 100)}%`, background: bounceColor }} />
          </div>
          <div className="gauge-threshold">
            Threshold: 2.0% (auto-pause) | {data.bounceRate >= 2.0 ? <span style={{ color: 'var(--red)' }}>PAUSED</span> : 'OK'}
          </div>
        </div>

        <div className="gauge-card fade-in stagger-2">
          <div className="gauge-label">Unsubscribe Rate (7d)</div>
          <div className="gauge-value" style={{ color: unsubColor }}>{data.unsubscribeRate.toFixed(2)}%</div>
          <div className="gauge-bar-track">
            <div className="gauge-bar-fill" style={{ width: `${Math.min(data.unsubscribeRate / 2 * 100, 100)}%`, background: unsubColor }} />
          </div>
          <div className="gauge-threshold">
            Threshold: 1.0% (alert) | {data.unsubscribeRate >= 1.0 ? <span style={{ color: 'var(--amber)' }}>ALERT</span> : 'OK'}
          </div>
        </div>

        <div className="gauge-card fade-in stagger-3">
          <div className="gauge-label">Reject List Size</div>
          <div className="gauge-value" style={{ color: 'var(--text-1)' }}>{data.rejectListSize}</div>
          <div className="gauge-threshold">Permanent blocks (bounces + unsubscribes)</div>
        </div>
      </div>

      {/* Outreach Domain */}
      <div className="section-title">Outreach Domain</div>
      <div className="card mb-lg">
        <div className="flex-between">
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, color: 'var(--green-bright)' }}>{data.domain}</div>
            <div className="td-dim" style={{ marginTop: '4px' }}>Primary outreach domain</div>
          </div>
          <span className="badge badge-green">ACTIVE</span>
        </div>
        <div className="td-dim" style={{ marginTop: '8px', fontStyle: 'italic' }}>DNS: SPF + DKIM + DMARC configured. Verify at mxtoolbox.com/SuperTool</div>
      </div>

      {/* Inbox Status */}
      <div className="section-title">Inbox Status</div>
      <div className="row mb-lg">
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: '8px' }}>{data.inboxes?.inbox1?.email || 'Inbox 1'}</div>
          <div className="td-muted" style={{ fontSize: '11px', marginBottom: '4px' }}>
            Last send: {data.inboxes?.inbox1?.lastSend ? new Date(data.inboxes.inbox1.lastSend).toLocaleString() : 'Never'}
          </div>
          <div className="td-dim">SMTP: smtp.gmail.com:587 | IMAP: imap.gmail.com:993</div>
        </div>
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: '8px' }}>{data.inboxes?.inbox2?.email || 'Inbox 2'}</div>
          <div className="td-muted" style={{ fontSize: '11px', marginBottom: '4px' }}>
            Last send: {data.inboxes?.inbox2?.lastSend ? new Date(data.inboxes.inbox2.lastSend).toLocaleString() : 'Never'}
          </div>
          <div className="td-dim">SMTP: smtp.gmail.com:587 | IMAP: imap.gmail.com:993</div>
        </div>
      </div>

      {/* Blacklist Status */}
      <div className="section-title">Domain Blacklist Status</div>
      <div className="card mb-lg">
        {data.blacklisted ? (
          <div className="alert alert-red" style={{ marginBottom: '12px' }}>BLACKLISTED — Sending should be paused</div>
        ) : (
          <div className="alert alert-green" style={{ marginBottom: '12px' }}>CLEAR — Not blacklisted</div>
        )}
        {BLACKLIST_ZONES.map(zone => {
          const isListed = Array.isArray(listedZones) && listedZones.includes(zone);
          return (
            <div key={zone} className="flex-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="td-muted">{zone}</span>
              <span className={`badge ${isListed ? 'badge-red' : 'badge-green'}`}>
                {isListed ? 'LISTED' : 'CLEAR'}
              </span>
            </div>
          );
        })}
        <div className="td-dim" style={{ marginTop: '12px', fontStyle: 'italic' }}>Checked weekly on Sundays at 2:00 AM via healthCheck.js</div>
      </div>

      {/* Mail Tester Score */}
      <div className="section-title">mail-tester.com Score</div>
      <div className="card mb-lg">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <span className="td-muted" style={{ fontSize: '12px' }}>Score (0-10):</span>
          <input
            type="number" min="0" max="10" step="0.1"
            value={mailTesterInput}
            onChange={e => setMailTesterInput(e.target.value)}
            className="input"
            style={{ width: '80px' }}
          />
          <button className="btn btn-green" onClick={handleSaveMailTester} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {data.mailTesterScore != null && (
          <div style={{ fontSize: '13px', color: data.mailTesterScore >= 9 ? 'var(--green)' : data.mailTesterScore >= 7 ? 'var(--amber)' : 'var(--red)' }}>
            Current: {data.mailTesterScore}/10
            {data.mailTesterDate && <span className="td-dim" style={{ marginLeft: '12px' }}>({data.mailTesterDate})</span>}
          </div>
        )}
        <div className="td-dim" style={{ marginTop: '8px', fontStyle: 'italic' }}>Manual weekly check every Monday. Target: 9-10/10</div>
      </div>

      {/* Postmaster */}
      <div className="section-title">Postmaster Tools</div>
      <div className="card">
        {data.postmasterReputation ? (
          <div className="td-muted" style={{ fontSize: '12px' }}>
            Reputation: <strong style={{ color: data.postmasterReputation === 'HIGH' ? 'var(--green)' : 'var(--red)' }}>{data.postmasterReputation}</strong>
          </div>
        ) : (
          <div className="td-dim">Phase 2 (needs 100+ Gmail recipients/day) — insufficient volume</div>
        )}
      </div>
    </div>
  );
}
