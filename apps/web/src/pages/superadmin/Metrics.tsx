import { useQuery, gql } from 'urql'
import PageHeader from '@/components/radar/PageHeader'
import { Badge, StatCard } from '@/components/radar/RadarUI'

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

  if (fetching && !data) {
    return (
      <>
        <PageHeader title="Platform metrics" subtitle="Superadmin" breadcrumb={['Superadmin', 'Metrics']} />
        <div style={{ color: 'var(--text-3)' }}>Loading…</div>
      </>
    )
  }
  if (error) {
    return (
      <>
        <PageHeader title="Platform metrics" subtitle="Superadmin" breadcrumb={['Superadmin', 'Metrics']} />
        <div style={{ color: 'var(--red)' }}>Error: {error.message}</div>
      </>
    )
  }

  const m = data?.adminMetrics

  return (
    <>
      <PageHeader
        title="Platform metrics"
        subtitle="Live across all orgs"
        breadcrumb={['Superadmin', 'Metrics']}
      />
      <div style={{ maxWidth: 1280 }}>
        <div style={{ marginBottom: 18 }}>
          <Badge tone="purple" icon="shield" size="md">SUPERADMIN · METRICS</Badge>
        </div>
        {m && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <StatCard label="Active orgs" value={String(m.activeOrgs)} tone="green" />
            <StatCard label="Trial orgs" value={String(m.trialOrgs)} tone="amber" sub="14d free each" />
            <StatCard label="MRR (₹)" value={m.totalMrr.toLocaleString('en-IN')} tone="green" />
            <StatCard
              label="API cost (USD)"
              value={`$${parseFloat(m.totalApiCostUsd).toFixed(2)}`}
              tone="cyan"
              sub="across all engines"
            />
          </div>
        )}
        <p style={{ marginTop: 24, fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
          Live from <code>adminMetrics</code> GraphQL query — refresh to update.
        </p>
      </div>
    </>
  )
}
