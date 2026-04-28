import { useState } from 'react'
import { useQuery, useMutation, gql } from 'urql'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

  if (fetching && !data) return <div style={{ padding: 32 }}>Loading...</div>
  if (error) return <div style={{ padding: 32, color: '#dc2626' }}>Error: {error.message}</div>

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
    <div style={{ maxWidth: 1200, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>All Organizations</h1>
        <Button onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Cancel' : '+ New org'}</Button>
      </div>

      {showCreate && (
        <div style={{ background: 'white', padding: 16, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: 16, display: 'flex', gap: 8 }}>
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

      <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
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
            {orgs.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No orgs match filter</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
