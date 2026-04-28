import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { logout } from '@/lib/auth'

interface Me { email: string; isSuperadmin: boolean }

export default function Profile() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // TODO: wire to GraphQL `query { me { ... } }` when resolver exists.
    // For now, decode the JWT cookie via /auth/google/token (already exists).
    fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/auth/google/token`, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) return null
        const { token } = (await r.json()) as { token?: string }
        if (!token) return null
        // Naive decode (not verify) — UI display only
        const [, payload] = token.split('.')
        return JSON.parse(atob(payload)) as { userId: number; orgId: number; isSuperadmin: boolean }
      })
      .then((p) => {
        if (p) setMe({ email: '(loading email...)', isSuperadmin: p.isSuperadmin })
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 32 }}>Loading...</div>

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Profile</h1>
      {me ? (
        <div style={{ background: 'white', padding: 24, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Email</label>
            <div style={{ fontSize: 16 }}>{me.email}</div>
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
      ) : (
        <p>Not signed in. <a href="/login">Sign in</a></p>
      )}
    </div>
  )
}
