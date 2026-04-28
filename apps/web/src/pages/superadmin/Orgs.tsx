import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface OrgRow {
  id: number
  name: string
  slug: string
  plan: string
  status: 'trial' | 'active' | 'locked' | 'suspended'
  mrrInr: number
  leadsToday: number
  seatsUsed: number
}

// TODO: replace with GraphQL `query adminOrgs(filter, page) { ... }` when resolver exists.
const PLACEHOLDER: OrgRow[] = [
  { id: 1, name: 'Simple Inc', slug: 'simpleinc', plan: 'Agency', status: 'active', mrrInr: 0, leadsToday: 0, seatsUsed: 1 },
]

const STATUS_BG: Record<OrgRow['status'], string> = {
  trial: '#fef3c7', active: '#dcfce7', locked: '#fee2e2', suspended: '#f1f5f9',
}
const STATUS_FG: Record<OrgRow['status'], string> = {
  trial: '#92400e', active: '#166534', locked: '#991b1b', suspended: '#475569',
}

export default function Orgs() {
  const [filter, setFilter] = useState<'all' | OrgRow['status']>('all')
  const orgs = filter === 'all' ? PLACEHOLDER : PLACEHOLDER.filter((o) => o.status === filter)

  return (
    <div style={{ maxWidth: 1200, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>All Organizations</h1>
        <Button>+ New org</Button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'trial', 'active', 'locked', 'suspended'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid',
              borderColor: filter === s ? '#3b82f6' : '#e2e8f0',
              background: filter === s ? '#dbeafe' : 'white',
              fontSize: 13,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              {['Name', 'Plan', 'Status', 'MRR', 'Leads today', 'Seats'].map((h) => (
                <th key={h} style={{ padding: 12, textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 500, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} style={{ borderTop: '1px solid #e2e8f0', cursor: 'pointer' }} onClick={() => { window.location.href = `/superadmin/orgs/${o.id}` }}>
                <td style={{ padding: 12, fontWeight: 500 }}>{o.name}<div style={{ fontSize: 12, color: '#64748b' }}>{o.slug}</div></td>
                <td style={{ padding: 12 }}>{o.plan}</td>
                <td style={{ padding: 12 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, background: STATUS_BG[o.status], color: STATUS_FG[o.status] }}>
                    {o.status}
                  </span>
                </td>
                <td style={{ padding: 12 }}>₹{o.mrrInr.toLocaleString('en-IN')}</td>
                <td style={{ padding: 12 }}>{o.leadsToday}</td>
                <td style={{ padding: 12 }}>{o.seatsUsed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
        TODO: wire to <code>adminOrgs</code> GraphQL query (resolver pending)
      </p>
    </div>
  )
}
