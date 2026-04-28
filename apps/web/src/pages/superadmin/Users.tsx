import { useQuery, gql } from 'urql'

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

  if (fetching && !data) return <div style={{ padding: 32 }}>Loading...</div>
  if (error) return <div style={{ padding: 32, color: '#dc2626' }}>Error: {error.message}</div>

  const users = data?.adminUsers ?? []

  return (
    <div style={{ maxWidth: 1100, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>All Users</h1>
      <p style={{ color: '#64748b', marginBottom: 24 }}>{users.length} total · superadmin badge marks platform staff</p>

      <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
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
  )
}
