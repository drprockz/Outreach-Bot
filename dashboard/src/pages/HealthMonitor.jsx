import React, { useEffect, useState } from 'react';
import { api } from '../api';

const pageTitle = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#e0e0e0',
  marginBottom: '24px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const sectionTitle = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#888',
  marginBottom: '16px',
  marginTop: '32px',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const cardStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '16px',
};

const gaugeContainerStyle = {
  display: 'flex',
  gap: '24px',
  flexWrap: 'wrap',
  marginBottom: '32px',
};

const gaugeCardStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '24px',
  flex: '1 1 260px',
  minWidth: '260px',
};

const gaugeLabel = {
  fontSize: '11px',
  fontWeight: 500,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  marginBottom: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const gaugeValue = {
  fontSize: '36px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  marginBottom: '8px',
};

const gaugeBarOuter = {
  width: '100%',
  height: '8px',
  background: '#2a2a2a',
  borderRadius: '4px',
  overflow: 'hidden',
  marginBottom: '8px',
};

const thresholdText = {
  fontSize: '10px',
  color: '#555',
  fontFamily: 'IBM Plex Mono, monospace',
};

const inboxRow = {
  display: 'flex',
  gap: '16px',
  flexWrap: 'wrap',
  marginBottom: '16px',
};

const inboxCardStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '20px',
  flex: '1 1 300px',
};

const inboxLabel = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#e0e0e0',
  fontFamily: 'IBM Plex Mono, monospace',
  marginBottom: '8px',
};

const inboxDetail = {
  fontSize: '11px',
  color: '#888',
  fontFamily: 'IBM Plex Mono, monospace',
  marginBottom: '4px',
};

const domainCardStyle = {
  display: 'flex',
  gap: '16px',
  alignItems: 'center',
};

const domainName = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#4ade80',
  fontFamily: 'IBM Plex Mono, monospace',
};

const rejectCountStyle = {
  fontSize: '13px',
  color: '#888',
  fontFamily: 'IBM Plex Mono, monospace',
};

const noteStyle = {
  fontSize: '11px',
  color: '#555',
  fontFamily: 'IBM Plex Mono, monospace',
  fontStyle: 'italic',
  marginTop: '8px',
};

function getGaugeColor(value, warnThreshold, criticalThreshold) {
  if (value >= criticalThreshold) return '#f87171';
  if (value >= warnThreshold) return '#facc15';
  return '#4ade80';
}

const blacklistZoneStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '8px 0',
  borderBottom: '1px solid #1f1f1f',
  fontSize: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const inputStyle = {
  padding: '8px 12px',
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: '6px',
  color: '#e0e0e0',
  fontSize: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
  outline: 'none',
  width: '80px',
};

const saveBtnStyle = {
  padding: '8px 16px',
  background: '#4ade8020',
  border: '1px solid #4ade8050',
  borderRadius: '4px',
  color: '#4ade80',
  fontSize: '11px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  cursor: 'pointer',
  marginLeft: '8px',
};

export default function HealthMonitor() {
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

  if (loading) {
    return (
      <div>
        <h1 style={pageTitle}>Health Monitor</h1>
        <div style={{ color: '#555', fontFamily: 'IBM Plex Mono, monospace' }}>Loading health data...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1 style={pageTitle}>Health Monitor</h1>
        <div style={{ color: '#f87171', fontFamily: 'IBM Plex Mono, monospace' }}>Failed to load health data.</div>
      </div>
    );
  }

  const bounceColor = getGaugeColor(data.bounceRate, 1.0, 2.0);
  const unsubColor = getGaugeColor(data.unsubscribeRate, 0.5, 1.0);

  return (
    <div>
      <h1 style={pageTitle}>Health Monitor</h1>

      <div style={gaugeContainerStyle}>
        <div style={gaugeCardStyle}>
          <div style={gaugeLabel}>Bounce Rate (Today)</div>
          <div style={{ ...gaugeValue, color: bounceColor }}>{data.bounceRate.toFixed(2)}%</div>
          <div style={gaugeBarOuter}>
            <div style={{
              width: `${Math.min(data.bounceRate / 4 * 100, 100)}%`,
              height: '100%',
              background: bounceColor,
              borderRadius: '4px',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={thresholdText}>
            Threshold: 2.0% (auto-pause) | Current: {data.bounceRate >= 2.0 ? 'PAUSED' : 'OK'}
          </div>
        </div>

        <div style={gaugeCardStyle}>
          <div style={gaugeLabel}>Unsubscribe Rate (7d)</div>
          <div style={{ ...gaugeValue, color: unsubColor }}>{data.unsubscribeRate.toFixed(2)}%</div>
          <div style={gaugeBarOuter}>
            <div style={{
              width: `${Math.min(data.unsubscribeRate / 2 * 100, 100)}%`,
              height: '100%',
              background: unsubColor,
              borderRadius: '4px',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={thresholdText}>
            Threshold: 1.0% (alert) | Current: {data.unsubscribeRate >= 1.0 ? 'ALERT' : 'OK'}
          </div>
        </div>

        <div style={gaugeCardStyle}>
          <div style={gaugeLabel}>Reject List Size</div>
          <div style={{ ...gaugeValue, color: '#e0e0e0' }}>{data.rejectListSize}</div>
          <div style={thresholdText}>Permanent blocks (bounces + unsubscribes)</div>
        </div>
      </div>

      <div style={sectionTitle}>Outreach Domain</div>
      <div style={cardStyle}>
        <div style={domainCardStyle}>
          <div style={domainName}>{data.domain}</div>
          <div style={rejectCountStyle}>Primary outreach domain</div>
        </div>
        <div style={noteStyle}>DNS: SPF + DKIM + DMARC configured. Verify at mxtoolbox.com/SuperTool</div>
      </div>

      <div style={sectionTitle}>Inbox Status</div>
      <div style={inboxRow}>
        <div style={inboxCardStyle}>
          <div style={inboxLabel}>{data.inboxes?.inbox1?.email || 'Inbox 1'}</div>
          <div style={inboxDetail}>
            Last successful send: {data.inboxes?.inbox1?.lastSend
              ? new Date(data.inboxes.inbox1.lastSend).toLocaleString()
              : 'Never'}
          </div>
          <div style={inboxDetail}>SMTP: smtp.gmail.com:587 | IMAP: imap.gmail.com:993</div>
        </div>
        <div style={inboxCardStyle}>
          <div style={inboxLabel}>{data.inboxes?.inbox2?.email || 'Inbox 2'}</div>
          <div style={inboxDetail}>
            Last successful send: {data.inboxes?.inbox2?.lastSend
              ? new Date(data.inboxes.inbox2.lastSend).toLocaleString()
              : 'Never'}
          </div>
          <div style={inboxDetail}>SMTP: smtp.gmail.com:587 | IMAP: imap.gmail.com:993</div>
        </div>
      </div>

      <div style={sectionTitle}>Domain Blacklist Status</div>
      <div style={cardStyle}>
        {data.blacklisted ? (
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#f87171', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '12px' }}>
            BLACKLISTED - Sending should be paused
          </div>
        ) : (
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#4ade80', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '12px' }}>
            CLEAR - Not blacklisted
          </div>
        )}
        {(() => {
          const zones = ['dbl.spamhaus.org', 'b.barracudacentral.org', 'multi.surbl.org'];
          const listedZones = data.blacklistZones ? (typeof data.blacklistZones === 'string' ? JSON.parse(data.blacklistZones || '[]') : data.blacklistZones) : [];
          return zones.map(zone => {
            const isListed = Array.isArray(listedZones) && listedZones.includes(zone);
            return (
              <div key={zone} style={blacklistZoneStyle}>
                <span style={{ color: '#aaa' }}>{zone}</span>
                <span style={{ color: isListed ? '#f87171' : '#4ade80', fontWeight: 600 }}>
                  {isListed ? 'LISTED' : 'CLEAR'}
                </span>
              </div>
            );
          });
        })()}
        <div style={{ ...noteStyle, marginTop: '12px' }}>Checked weekly on Sundays at 2:00 AM via healthCheck.js</div>
      </div>

      <div style={sectionTitle}>mail-tester.com Score</div>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <span style={{ fontSize: '12px', color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Score (0-10):</span>
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={mailTesterInput}
            onChange={e => setMailTesterInput(e.target.value)}
            style={inputStyle}
          />
          <button onClick={handleSaveMailTester} disabled={saving} style={saveBtnStyle}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {data.mailTesterScore != null && (
          <div style={{ fontSize: '13px', fontFamily: 'IBM Plex Mono, monospace', color: data.mailTesterScore >= 9 ? '#4ade80' : data.mailTesterScore >= 7 ? '#facc15' : '#f87171' }}>
            Current: {data.mailTesterScore}/10
            {data.mailTesterDate && <span style={{ color: '#555', marginLeft: '12px' }}>({data.mailTesterDate})</span>}
          </div>
        )}
        <div style={noteStyle}>Manual weekly check every Monday. Target: 9-10/10</div>
      </div>

      <div style={sectionTitle}>Postmaster Tools</div>
      <div style={cardStyle}>
        <div style={{ fontSize: '12px', color: '#888', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '8px' }}>
          {data.postmaster_reputation
            ? <span>Reputation: <strong style={{ color: data.postmaster_reputation === 'HIGH' ? '#4ade80' : data.postmaster_reputation === 'LOW' || data.postmaster_reputation === 'BAD' ? '#f87171' : '#facc15' }}>{data.postmaster_reputation}</strong></span>
            : 'Phase 2 (needs 100+ Gmail recipients/day) - insufficient volume'}
        </div>
      </div>
    </div>
  );
}
