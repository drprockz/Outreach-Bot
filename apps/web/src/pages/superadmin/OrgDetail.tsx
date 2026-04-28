import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function OrgDetail() {
  const { id } = useParams()

  return (
    <div style={{ maxWidth: 1000, margin: '40px auto', padding: 24 }}>
      <a href="/superadmin/orgs" style={{ color: '#64748b', fontSize: 14, textDecoration: 'none' }}>← All organizations</a>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>Org #{id}</h1>

      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Members">
          <p style={{ color: '#64748b' }}>TODO: list members from <code>adminOrg(id).memberships</code></p>
        </Card>
        <Card title="Billing history">
          <p style={{ color: '#64748b' }}>TODO: list webhook events</p>
        </Card>
        <Card title="Plan override">
          <p style={{ color: '#64748b', marginBottom: 12 }}>Force a plan change without billing</p>
          <Button variant="outline" disabled>Change plan</Button>
        </Card>
        <Card title="Actions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button variant="outline" disabled>Reset trial</Button>
            <Button variant="outline" disabled>Impersonate</Button>
            <Button variant="destructive" disabled>Suspend org</Button>
          </div>
        </Card>
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
        TODO: wire to <code>adminOrg(id)</code> GraphQL query + admin mutations (resolvers pending)
      </p>
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: 'white', padding: 20, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h2>
      {children}
    </div>
  )
}
