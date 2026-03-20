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

export default function HealthMonitor() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.health().then(d => {
      setData(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

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

      <div style={sectionTitle}>External Checks</div>
      <div style={cardStyle}>
        <div style={{ fontSize: '12px', color: '#888', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '8px' }}>
          <strong>mail-tester.com:</strong> Manual weekly check every Monday. Target: 9-10/10
        </div>
        <div style={{ fontSize: '12px', color: '#888', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '8px' }}>
          <strong>Postmaster Tools:</strong> Phase 2 (needs 100+ Gmail recipients/day)
        </div>
        <div style={noteStyle}>
          Blacklist DNS zones checked weekly: dbl.spamhaus.org, b.barracudacentral.org, multi.surbl.org
        </div>
      </div>
    </div>
  );
}
