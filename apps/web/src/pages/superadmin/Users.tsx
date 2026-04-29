import { useQuery, gql } from 'urql'
import PageHeader from '@/components/radar/PageHeader'
import { Badge } from '@/components/radar/RadarUI'

interface AdminUser {
  id: number
  email: string
  isSuperadmin: boolean
  lastLoginAt: string | null
  orgId: number | null
  role: string | null
}

const ADMIN_USERS_QUERY = gql`
  query AdminUsers {
    adminUsers { id email isSuperadmin lastLoginAt orgId role }
  }
`

export default function Users() {
  const [{ data, fetching, error }] = useQuery<{ adminUsers: AdminUser[] }>({ query: ADMIN_USERS_QUERY })

  if (fetching && !data) return <><PageHeader title="All users" subtitle="Superadmin" breadcrumb={['Superadmin', 'Users']} /><div style={{ color: 'var(--text-3)' }}>Loading…</div></>
  if (error) return <><PageHeader title="All users" subtitle="Superadmin" breadcrumb={['Superadmin', 'Users']} /><div style={{ color: 'var(--red)' }}>Error: {error.message}</div></>

  const users = data?.adminUsers ?? []

  return (
    <>
    <PageHeader
      title="All users"
      subtitle={`${users.length} total · superadmin badge marks platform staff`}
      breadcrumb={['Superadmin', 'Users']}
    />
    <div style={{ maxWidth: 1280 }}>
      <div style={{ marginBottom: 16 }}>
        <Badge tone="purple" icon="shield" size="md">SUPERADMIN</Badge>
      </div>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              {['Email', 'Org', 'Role', 'Last login'].map((h) => (
                <th key={h} style={{ padding: 12, textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 500, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={{ padding: 12 }}>
                  {u.email}
                  {u.isSuperadmin && (
                    <span style={{ marginLeft: 8, padding: '2px 6px', borderRadius: 4, fontSize: 11, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>SUPERADMIN</span>
                  )}
                </td>
                <td style={{ padding: 12, fontSize: 13, color: '#64748b' }}>
                  {u.orgId ? <a href={`/superadmin/orgs/${u.orgId}`} style={{ color: '#3b82f6', textDecoration: 'none' }}>#{u.orgId}</a> : '—'}
                </td>
                <td style={{ padding: 12, textTransform: 'capitalize' }}>{u.role ?? '—'}</td>
                <td style={{ padding: 12, fontSize: 13, color: '#64748b' }}>
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </>
  )
}
