export default function Metrics() {
  const stats = [
    { label: 'Active orgs', value: '1' },
    { label: 'MRR (₹)', value: '0' },
    { label: 'Leads processed (24h)', value: '0' },
    { label: 'API cost burn (24h)', value: '$0.00' },
  ]
  return (
    <div style={{ maxWidth: 1200, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>System Metrics</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: 'white', padding: 24, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>{s.label}</div>
            <div style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 24, fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
        TODO: wire to <code>adminMetrics</code> GraphQL query (resolver pending)
      </p>
    </div>
  )
}
