import { useState } from 'react'
import { useQuery, useMutation, gql } from 'urql'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/radar/PageHeader'

interface Member { userId: number; email: string; role: 'owner' | 'admin' }

const MEMBERS_QUERY = gql`
  query Members {
    members { userId email role }
    me { id email isSuperadmin }
  }
`

const INVITE_MUTATION = gql`
  mutation InviteMember($email: String!) {
    inviteMember(email: $email) { userId email role }
  }
`

const REMOVE_MUTATION = gql`
  mutation RemoveMember($userId: Int!) {
    removeMember(userId: $userId)
  }
`

export default function Team() {
  const [{ data, fetching, error }, refetch] = useQuery<{
    members: Member[]
    me: { id: number; email: string; isSuperadmin: boolean } | null
  }>({ query: MEMBERS_QUERY })

  const [, invite] = useMutation(INVITE_MUTATION)
  const [, remove] = useMutation(REMOVE_MUTATION)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [opError, setOpError] = useState('')
  const [opSuccess, setOpSuccess] = useState('')

  const isOwner = data?.members?.some((m) => m.email === data.me?.email && m.role === 'owner') ?? false

  const handleInvite = async () => {
    setOpError('')
    setOpSuccess('')
    if (!inviteEmail.includes('@')) {
      setOpError('Valid email required')
      return
    }
    setInviting(true)
    try {
      const result = await invite({ email: inviteEmail })
      if (result.error) {
        setOpError(result.error.graphQLErrors[0]?.message ?? result.error.message)
      } else {
        setOpSuccess(`Invitation email sent to ${inviteEmail}`)
        setInviteEmail('')
        refetch({ requestPolicy: 'network-only' })
      }
    } finally {
      setInviting(false)
    }
  }

  const handleRemove = async (userId: number, email: string) => {
    if (!confirm(`Remove ${email} from your team? Their session will be ended.`)) return
    setOpError('')
    setOpSuccess('')
    const result = await remove({ userId })
    if (result.error) {
      setOpError(result.error.graphQLErrors[0]?.message ?? result.error.message)
    } else {
      setOpSuccess(`Removed ${email}`)
      refetch({ requestPolicy: 'network-only' })
    }
  }

  if (fetching && !data) return <><PageHeader title="Team" subtitle="Members and roles" /><div style={{ color: 'var(--text-3)' }}>Loading team…</div></>
  if (error) return <><PageHeader title="Team" subtitle="Members and roles" /><div style={{ color: 'var(--red)' }}>Error: {error.message}</div></>

  const members = data?.members ?? []

  return (
    <>
    <PageHeader title="Team" subtitle="Manage who has access to your workspace" />
    <div style={{ maxWidth: 880 }}>

      {isOwner && (
        <div style={{ background: 'var(--bg-surface)', padding: 24, borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Invite a member</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              type="email"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !inviting) void handleInvite() }}
              style={{ flex: 1 }}
            />
            <Button onClick={() => void handleInvite()} disabled={inviting || !inviteEmail}>
              {inviting ? 'Sending...' : 'Send invite'}
            </Button>
          </div>
          {opError && <p style={{ color: '#dc2626', fontSize: 14, marginTop: 8 }}>{opError}</p>}
          {opSuccess && <p style={{ color: '#166534', fontSize: 14, marginTop: 8 }}>{opSuccess}</p>}
        </div>
      )}

      <div style={{ background: 'var(--bg-surface)', padding: 24, borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
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
              <tr key={m.userId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 0' }}>{m.email}</td>
                <td style={{ padding: '12px 0', textTransform: 'capitalize' }}>{m.role}</td>
                <td style={{ padding: '12px 0', textAlign: 'right' }}>
                  {isOwner && m.role !== 'owner' && (
                    <Button variant="ghost" size="sm" onClick={() => void handleRemove(m.userId, m.email)}>
                      Remove
                    </Button>
                  )}
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
