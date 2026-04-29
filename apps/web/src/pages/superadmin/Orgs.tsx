import { useState } from 'react'
import { useQuery, useMutation, gql } from 'urql'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/radar/PageHeader'
import { Badge } from '@/components/radar/RadarUI'

interface OrgRow {
  id: number
  name: string
  slug: string
  status: 'trial' | 'active' | 'locked' | 'suspended'
  planName: string | null
  planPriceInr: number | null
  subscriptionStatus: string | null
  createdAt: string
}

const ADMIN_ORGS_QUERY = gql`
  query AdminOrgs {
    adminOrgs { id name slug status planName planPriceInr subscriptionStatus createdAt }
  }
`

const CREATE_ORG_MUTATION = gql`
  mutation AdminCreateOrg($name: String!, $ownerEmail: String!) {
    adminCreateOrg(name: $name, ownerEmail: $ownerEmail) { id name slug status }
  }
`

const STATUS_BG: Record<OrgRow['status'], string> = {
  trial: '#fef3c7', active: '#dcfce7', locked: '#fee2e2', suspended: '#f1f5f9',
}
const STATUS_FG: Record<OrgRow['status'], string> = {
  trial: '#92400e', active: '#166534', locked: '#991b1b', suspended: '#475569',
}

export default function Orgs() {
  const [{ data, fetching, error }, refetch] = useQuery<{ adminOrgs: OrgRow[] }>({ query: ADMIN_ORGS_QUERY })
  const [, createOrg] = useMutation(CREATE_ORG_MUTATION)
  const [filter, setFilter] = useState<'all' | OrgRow['status']>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [opError, setOpError] = useState('')
  const [creating, setCreating] = useState(false)

  if (fetching && !data) return <><PageHeader title="All organizations" subtitle="Superadmin" /><div style={{ color: 'var(--text-3)' }}>Loading…</div></>
  if (error) return <><PageHeader title="All organizations" subtitle="Superadmin" /><div style={{ color: 'var(--red)' }}>Error: {error.message}</div></>

  const orgs = (data?.adminOrgs ?? []).filter((o) => filter === 'all' || o.status === filter)

  const handleCreate = async () => {
    setOpError('')
    if (!newName || !newEmail.includes('@')) {
      setOpError('Name and valid owner email required')
      return
    }
    setCreating(true)
    try {
      const result = await createOrg({ name: newName, ownerEmail: newEmail })
      if (result.error) {
        setOpError(result.error.graphQLErrors[0]?.message ?? result.error.message)
      } else {
        setNewName(''); setNewEmail(''); setShowCreate(false)
        refetch({ requestPolicy: 'network-only' })
      }
    } finally { setCreating(false) }
  }

  return (
    <>
    <PageHeader
      title="All organizations"
      subtitle={`${data?.adminOrgs?.length ?? 0} orgs`}
      breadcrumb={['Superadmin', 'Orgs']}
      action={<Button onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Cancel' : '+ New org'}</Button>}
    />
    <div style={{ maxWidth: 1280 }}>
      <div style={{ marginBottom: 8 }}>
        <Badge tone="purple" icon="shield" size="md">SUPERADMIN</Badge>
      </div>

      {showCreate && (
        <div style={{ background: 'var(--bg-surface)', padding: 16, borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', marginBottom: 16, display: 'flex', gap: 8 }}>
          <Input placeholder="Org name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }} />
          <Input type="email" placeholder="owner@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} style={{ flex: 1 }} />
          <Button onClick={() => void handleCreate()} disabled={creating}>{creating ? 'Creating...' : 'Create'}</Button>
        </div>
      )}
      {opError && <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 16 }}>{opError}</p>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'trial', 'active', 'locked', 'suspended'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid', borderColor: filter === s ? '#3b82f6' : '#e2e8f0',
                     background: filter === s ? '#dbeafe' : 'white', fontSize: 13, cursor: 'pointer', textTransform: 'capitalize' }}>
            {s}
          </button>
        ))}
      </div>

      <div style={{ background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>{['Name', 'Plan', 'Status', 'Price', 'Sub status', 'Created'].map((h) => (
              <th key={h} style={{ padding: 12, textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 500, textTransform: 'uppercase' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} style={{ borderTop: '1px solid #e2e8f0', cursor: 'pointer' }}
                  onClick={() => { window.location.href = `/superadmin/orgs/${o.id}` }}>
                <td style={{ padding: 12, fontWeight: 500 }}>{o.name}<div style={{ fontSize: 12, color: '#64748b' }}>{o.slug}</div></td>
                <td style={{ padding: 12 }}>{o.planName ?? '—'}</td>
                <td style={{ padding: 12 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, background: STATUS_BG[o.status], color: STATUS_FG[o.status] }}>{o.status}</span>
                </td>
                <td style={{ padding: 12 }}>{o.planPriceInr != null ? `₹${o.planPriceInr.toLocaleString('en-IN')}` : '—'}</td>
                <td style={{ padding: 12, fontSize: 13, color: '#64748b' }}>{o.subscriptionStatus ?? '—'}</td>
                <td style={{ padding: 12, fontSize: 13, color: '#64748b' }}>{new Date(o.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {orgs.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>No orgs match filter</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
    </>
  )
}
