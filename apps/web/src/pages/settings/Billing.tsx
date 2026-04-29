import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/radar/PageHeader'

interface BillingPortal {
  plan: string
  priceInr: number
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  graceEndsAt: string | null
  cancelAtPeriodEnd: boolean
  limitsJson: Record<string, unknown>
  usage: { leadsToday: number; claudeSpendUsd: number; geminiQueriesUsed: number }
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export default function Billing() {
  const [data, setData] = useState<BillingPortal | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    setLoading(true)
    fetch(`${API_URL}/api/billing/portal`, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed (${r.status})`)
        return (await r.json()) as BillingPortal
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [])

  const handleCancel = async () => {
    if (!confirm('Cancel subscription at end of current period?')) return
    const res = await fetch(`${API_URL}/api/billing/cancel`, { method: 'POST', credentials: 'include' })
    if (!res.ok) {
      setError('Failed to cancel')
      return
    }
    refresh()
  }

  if (loading) return <><PageHeader title="Billing" subtitle="Plan, usage, and history" /><div style={{ color: 'var(--text-3)' }}>Loading billing info…</div></>
  if (error) return <><PageHeader title="Billing" subtitle="Plan, usage, and history" /><div style={{ color: 'var(--red)' }}>Error: {error}</div></>
  if (!data) return null

  const limits = data.limitsJson as { leadsPerDay: number; seats: number; claudeDailySpendCapUsd: number; geminiQueriesPerDay: number }

  return (
    <>
    <PageHeader title="Billing" subtitle="Plan, usage, and history" />
    <div style={{ maxWidth: 880 }}>
      <div style={{ background: 'var(--bg-surface)', padding: 24, borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>Current plan</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{data.plan}</div>
            <div style={{ fontSize: 14, color: '#64748b', marginTop: 2 }}>
              ₹{data.priceInr.toLocaleString('en-IN')}/mo · status: <strong>{data.status}</strong>
            </div>
          </div>
          <div>
            {data.cancelAtPeriodEnd ? (
              <span style={{ fontSize: 14, color: '#dc2626' }}>Cancels at period end</span>
            ) : (
              <Button variant="outline" onClick={handleCancel}>Cancel plan</Button>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Usage today</div>
          <UsageBar label="Leads" used={data.usage.leadsToday} max={limits.leadsPerDay === -1 ? null : limits.leadsPerDay} />
          <UsageBar label="Claude $ spent" used={data.usage.claudeSpendUsd} max={limits.claudeDailySpendCapUsd} format="usd" />
          <UsageBar label="Gemini queries" used={data.usage.geminiQueriesUsed} max={limits.geminiQueriesPerDay} />
        </div>
      </div>

      {data.status === 'trial' && data.trialEndsAt && (
        <div style={{ background: 'var(--amber-dim)', border: '1px solid #fde68a', padding: 16, borderRadius: 8, fontSize: 14, color: '#92400e' }}>
          Trial ends {new Date(data.trialEndsAt).toLocaleDateString()}
        </div>
      )}
    </div>
    </>
  )
}

function UsageBar({ label, used, max, format }: { label: string; used: number; max: number | null; format?: 'usd' }) {
  const pct = max === null ? 0 : Math.min(100, (used / max) * 100)
  const formatNum = (n: number) => format === 'usd' ? `$${n.toFixed(2)}` : n.toLocaleString('en-IN')
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: '#64748b' }}>{formatNum(used)}{max !== null ? ` / ${formatNum(max)}` : ' (unlimited)'}</span>
      </div>
      {max !== null && (
        <div style={{ background: '#e2e8f0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{ background: pct > 90 ? '#dc2626' : pct > 75 ? '#f59e0b' : '#3b82f6', height: '100%', width: `${pct}%`, transition: 'width 0.3s' }} />
        </div>
      )}
    </div>
  )
}
