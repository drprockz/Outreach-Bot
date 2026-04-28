import { useQuery, gql } from 'urql'

interface AdminMetrics {
  activeOrgs: number
  trialOrgs: number
  totalMrr: number
  totalApiCostUsd: string
}

const ADMIN_METRICS_QUERY = gql`
  query AdminMetrics {
    adminMetrics { activeOrgs trialOrgs totalMrr totalApiCostUsd }
  }
`

export default function Metrics() {
  const [{ data, fetching, error }] = useQuery<{ adminMetrics: AdminMetrics }>({ query: ADMIN_METRICS_QUERY })

  if (fetching && !data) return <div style={{ padding: 32 }}>Loading...</div>
  if (error) return <div style={{ padding: 32, color: '#dc2626' }}>Error: {error.message}</div>

  const m = data?.adminMetrics
  const stats = m ? [
    { label: 'Active orgs', value: String(m.activeOrgs) },
    { label: 'Trial orgs', value: String(m.trialOrgs) },
    { label: 'MRR (₹)', value: m.totalMrr.toLocaleString('en-IN') },
    { label: 'API cost burn', value: `$${parseFloat(m.totalApiCostUsd).toFixed(2)}` },
  ] : []

  return (
    <div style={{ maxWidth: 1200, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>System Metrics</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: 'white', padding: 24, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>{s.label}</div>
            <div style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 24, fontSize: 13, color: '#94a3b8' }}>
        Live from <code>adminMetrics</code> GraphQL query — refresh page to update.
      </p>
    </div>
  )
}
