import { useQuery, gql } from 'urql'
import { Button } from '@/components/ui/button'
import { logout } from '@/lib/auth'

interface MeQueryShape {
  me: {
    id: number
    email: string
    isSuperadmin: boolean
    lastLoginAt: string | null
    org: { id: number; name: string; slug: string; status: string } | null
    role: string | null
  } | null
}

const ME_QUERY = gql`
  query MeProfile {
    me {
      id
      email
      isSuperadmin
      lastLoginAt
      org { id name slug status }
      role
    }
  }
`

export default function Profile() {
  const [{ data, fetching, error }] = useQuery<MeQueryShape>({ query: ME_QUERY })

  if (fetching && !data) return <div style={{ padding: 32 }}>Loading…</div>
  if (error) return <div style={{ padding: 32, color: '#dc2626' }}>Error: {error.message}</div>
  if (!data?.me) {
    return (
      <div style={{ padding: 32 }}>
        Not signed in. <a href="/login">Sign in</a>
      </div>
    )
  }

  const { me } = data
  const lastLogin = me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString() : 'Never'

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Profile</h1>
      <div style={{ background: 'white', padding: 24, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Email</label>
          <div style={{ fontSize: 16 }}>{me.email}</div>
        </div>
        {me.org && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Organization</label>
            <div style={{ fontSize: 16 }}>{me.org.name} <span style={{ color: '#94a3b8', fontSize: 14 }}>({me.org.slug})</span></div>
          </div>
        )}
        {me.role && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Role</label>
            <div style={{ fontSize: 16, textTransform: 'capitalize' }}>{me.role}</div>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Last sign-in</label>
          <div style={{ fontSize: 14, color: '#475569' }}>{lastLogin}</div>
        </div>
        {me.isSuperadmin && (
          <div style={{ marginBottom: 16 }}>
            <span style={{ background: '#dbeafe', color: '#1e40af', padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
              Superadmin
            </span>
          </div>
        )}
        <Button variant="outline" onClick={() => { void logout() }}>Sign out</Button>
      </div>
    </div>
  )
}
