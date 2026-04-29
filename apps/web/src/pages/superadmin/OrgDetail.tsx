import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, gql } from 'urql'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/radar/PageHeader'
import { Status, PlanBadge } from '@/components/radar/RadarUI'

interface AdminOrg {
  id: number; name: string; slug: string
  status: 'trial' | 'active' | 'locked' | 'suspended'
  planName: string | null
  planPriceInr: number | null
  subscriptionStatus: string | null
  createdAt: string
}

const ADMIN_ORG_QUERY = gql`
  query AdminOrg($id: Int!) {
    adminOrg(id: $id) {
      id name slug status planName planPriceInr subscriptionStatus createdAt
    }
  }
`

const SUSPEND = gql`mutation Suspend($orgId: Int!) { adminSuspendOrg(orgId: $orgId) }`
const OVERRIDE = gql`mutation Override($orgId: Int!, $planId: Int!) { adminOverridePlan(orgId: $orgId, planId: $planId) }`
const RESET_TRIAL = gql`mutation ResetTrial($orgId: Int!, $days: Int!) { adminResetTrial(orgId: $orgId, days: $days) }`
const IMPERSONATE = gql`mutation Impersonate($orgId: Int!) { adminImpersonate(orgId: $orgId) { token } }`
const DELETE_ORG = gql`mutation DeleteOrg($orgId: Int!, $confirmToken: String!) { adminDeleteOrg(orgId: $orgId, confirmToken: $confirmToken) }`

export default function OrgDetail() {
  const { id } = useParams()
  const orgId = parseInt(id ?? '0', 10)
  const [{ data, fetching, error }, refetch] = useQuery<{ adminOrg: AdminOrg | null }>({
    query: ADMIN_ORG_QUERY, variables: { id: orgId }, pause: !orgId,
  })

  const [, suspend] = useMutation(SUSPEND)
  const [, override] = useMutation(OVERRIDE)
  const [, resetTrial] = useMutation(RESET_TRIAL)
  const [, impersonate] = useMutation(IMPERSONATE)
  const [, deleteOrg] = useMutation(DELETE_ORG)

  const [planIdInput, setPlanIdInput] = useState('')
  const [trialDays, setTrialDays] = useState('14')
  const [opError, setOpError] = useState('')
  const [opSuccess, setOpSuccess] = useState('')

  const wrap = async (label: string, action: () => Promise<{ error?: { message: string; graphQLErrors: { message: string }[] } }>) => {
    setOpError(''); setOpSuccess('')
    const result = await action()
    if (result.error) {
      setOpError(result.error.graphQLErrors[0]?.message ?? result.error.message)
    } else {
      setOpSuccess(`${label} succeeded`)
      refetch({ requestPolicy: 'network-only' })
    }
  }

  if (fetching && !data) return <><PageHeader title="Loading…" subtitle="Superadmin" breadcrumb={['Superadmin', 'Orgs']} /><div style={{ color: 'var(--text-3)' }}>Loading…</div></>
  if (error) return <><PageHeader title="Error" subtitle="Superadmin" breadcrumb={['Superadmin', 'Orgs']} /><div style={{ color: 'var(--red)' }}>Error: {error.message}</div></>
  if (!data?.adminOrg) return <><PageHeader title="Not found" subtitle="Superadmin" breadcrumb={['Superadmin', 'Orgs']} /><div style={{ color: 'var(--red)' }}>Org not found</div></>

  const org = data.adminOrg

  return (
    <>
    <PageHeader
      title={org.name}
      subtitle={`#${org.id} · ${org.slug} · created ${new Date(org.createdAt).toLocaleDateString()}`}
      breadcrumb={['Superadmin', 'Orgs', org.name]}
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {org.planName && <PlanBadge plan={org.planName} />}
          <Status status={org.status} />
        </div>
      }
    />
    <div style={{ maxWidth: 1100 }}>

      {opError && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 6, fontSize: 14, marginBottom: 16 }}>{opError}</div>}
      {opSuccess && <div style={{ background: '#dcfce7', color: '#166534', padding: 12, borderRadius: 6, fontSize: 14, marginBottom: 16 }}>{opSuccess}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Plan override">
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>Force a plan change without billing.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input placeholder="Plan ID (1-4)" value={planIdInput} onChange={(e) => setPlanIdInput(e.target.value.replace(/\D/g, ''))} />
            <Button variant="outline" onClick={() => void wrap('Plan override', () => override({ orgId, planId: parseInt(planIdInput, 10) }))} disabled={!planIdInput}>Apply</Button>
          </div>
        </Card>

        <Card title="Reset trial">
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>Set trial back to N days from now.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input type="number" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
            <Button variant="outline" onClick={() => void wrap('Trial reset', () => resetTrial({ orgId, days: parseInt(trialDays, 10) }))}>Reset</Button>
          </div>
        </Card>

        <Card title="Impersonate">
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>Issues a 1-hour scoped JWT and redirects to dashboard as this org.</p>
          <Button variant="outline" onClick={async () => {
            const result = await impersonate({ orgId })
            if (result.error) { setOpError(result.error.message); return }
            const token = (result.data as { adminImpersonate: { token: string } } | undefined)?.adminImpersonate.token
            if (token) {
              // Set the impersonation token as cookie via the URL hash, then redirect.
              // For now we just store and redirect; backend needs an /api/auth/exchange endpoint
              // to convert the token into a cookie. As a workaround, frontend uses Bearer.
              localStorage.setItem('impersonation_token', token)
              alert('Impersonation token issued (1h). Open dashboard with Bearer token; future enhancement: cookie exchange endpoint.')
            }
          }}>Impersonate</Button>
        </Card>

        <Card title="Suspend / Delete">
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>Hard suspend revokes all org sessions immediately.</p>
          <Button variant="outline" onClick={() => { if (confirm('Suspend org?')) void wrap('Suspend', () => suspend({ orgId })) }}>Suspend</Button>
          <Button variant="destructive" style={{ marginLeft: 8 }} onClick={async () => {
            const token = prompt(`Type the org slug "${org.slug}" to confirm hard delete:`)
            if (token === org.slug) {
              await wrap('Delete', () => deleteOrg({ orgId, confirmToken: token }))
              setTimeout(() => { window.location.href = '/superadmin/orgs' }, 1500)
            }
          }}>Delete</Button>
        </Card>
      </div>
    </div>
    </>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', padding: 20, borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
      <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.6, fontFamily: 'var(--font-mono)' }}>{title}</h2>
      {children}
    </div>
  )
}
