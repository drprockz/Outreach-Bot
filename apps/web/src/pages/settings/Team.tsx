import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Member { id: number; email: string; role: 'owner' | 'admin' }

export default function Team() {
  // TODO: wire to GraphQL `query { members { id email role } }` when resolver exists.
  const [members] = useState<Member[]>([
    { id: 1, email: 'darshanrajeshparmar@gmail.com', role: 'owner' },
  ])
  const [inviteEmail, setInviteEmail] = useState('')
  const [error, setError] = useState('')

  const handleInvite = () => {
    if (!inviteEmail.includes('@')) {
      setError('Valid email required')
      return
    }
    // TODO: call inviteMember GraphQL mutation
    setError('Invite functionality not yet implemented (GraphQL mutation pending)')
  }

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Team</h1>
      <p style={{ color: '#64748b', marginBottom: 24 }}>Manage who has access to your workspace</p>

      <div style={{ background: 'white', padding: 24, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Invite a member</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            type="email"
            placeholder="colleague@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            style={{ flex: 1 }}
          />
          <Button onClick={handleInvite}>Send invite</Button>
        </div>
        {error && <p style={{ color: '#dc2626', fontSize: 14, marginTop: 8 }}>{error}</p>}
      </div>

      <div style={{ background: 'white', padding: 24, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Current members ({members.length})</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
              <th style={{ padding: '8px 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}>EMAIL</th>
              <th style={{ padding: '8px 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}>ROLE</th>
              <th style={{ padding: '8px 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 0' }}>{m.email}</td>
                <td style={{ padding: '12px 0', textTransform: 'capitalize' }}>{m.role}</td>
                <td style={{ padding: '12px 0', textAlign: 'right' }}>
                  {m.role !== 'owner' && (
                    <Button variant="ghost" size="sm" disabled>Remove</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
