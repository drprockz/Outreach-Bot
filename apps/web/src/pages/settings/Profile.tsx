import { useQuery, gql } from 'urql'
import { Button } from '@/components/ui/button'
import { logout } from '@/lib/auth'
import PageHeader from '@/components/radar/PageHeader'

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

  if (fetching && !data) return <><PageHeader title="Profile" subtitle="Your account" /><div style={{ color: 'var(--text-3)' }}>Loading…</div></>
  if (error) return <><PageHeader title="Profile" subtitle="Your account" /><div style={{ color: 'var(--red)' }}>Error: {error.message}</div></>
  if (!data?.me) {
    return (
      <>
        <PageHeader title="Profile" subtitle="Your account" />
        <div style={{ color: 'var(--text-3)' }}>
          Not signed in. <a href="/login" style={{ color: 'var(--green-bright)' }}>Sign in</a>
        </div>
      </>
    )
  }

  const { me } = data
  const lastLogin = me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString() : 'Never'

  return (
    <>
      <PageHeader title="Profile" subtitle="Your account" />
      <div style={{ maxWidth: 720 }}>
        <div style={{
          background: 'var(--bg-surface)',
          padding: 24,
          borderRadius: 10,
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Email</label>
            <div style={{ fontSize: 16, color: 'var(--text-1)' }}>{me.email}</div>
          </div>
          {me.org && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Organization</label>
              <div style={{ fontSize: 16, color: 'var(--text-1)' }}>{me.org.name} <span style={{ color: 'var(--text-3)', fontSize: 14 }}>({me.org.slug})</span></div>
            </div>
          )}
          {me.role && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Role</label>
              <div style={{ fontSize: 16, textTransform: 'capitalize', color: 'var(--text-1)' }}>{me.role}</div>
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Last sign-in</label>
            <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{lastLogin}</div>
          </div>
          {me.isSuperadmin && (
            <div style={{ marginBottom: 16 }}>
              <span style={{ background: 'var(--blue-dim)', color: 'var(--blue)', padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                Superadmin
              </span>
            </div>
          )}
          <Button variant="outline" onClick={() => { void logout() }}>Sign out</Button>
        </div>
      </div>
    </>
  )
}
