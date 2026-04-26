import { Button } from '@/components/ui/button'

interface Plan { id: number; name: string; priceInr: number; features: string[] }

const PLANS: Plan[] = [
  { id: 2, name: 'Starter', priceInr: 2999, features: ['34 leads/day', '2 seats', 'CSV export'] },
  { id: 3, name: 'Growth', priceInr: 6999, features: ['68 leads/day', '5 seats', 'Bulk retry'] },
  { id: 4, name: 'Agency', priceInr: 14999, features: ['Unlimited leads', '10 seats', 'API access'] },
]

interface Props { onSelectPlan: (planId: number) => void }

export function PaywallPage({ onSelectPlan }: Props) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa', padding: 32 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Your trial has ended</h1>
      <p style={{ color: '#64748b', marginBottom: 40 }}>Choose a plan to keep your outreach running</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24, maxWidth: 960, width: '100%' }}>
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            style={{
              background: 'white',
              borderRadius: 12,
              boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{plan.name}</h2>
              <p style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', margin: '4px 0 0 0' }}>
                ₹{plan.priceInr.toLocaleString('en-IN')}
                <span style={{ fontSize: 14, fontWeight: 400, color: '#64748b' }}>/mo</span>
              </p>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {plan.features.map((f) => (
                <li key={f} style={{ fontSize: 14, color: '#475569' }}>✓ {f}</li>
              ))}
            </ul>
            <Button className="w-full" onClick={() => onSelectPlan(plan.id)}>
              Get {plan.name}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
