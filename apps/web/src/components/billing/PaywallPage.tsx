import Icon from '@/components/radar/Icon'
import { Badge, Button, PlanBadge, RadarLogo } from '@/components/radar/RadarUI'

interface Plan {
  id: number
  name: 'Starter' | 'Growth' | 'Agency'
  priceInr: number
  features: string[]
  popular?: boolean
}

const PLANS: Plan[] = [
  { id: 2, name: 'Starter', priceInr: 2999, features: ['34 leads / day', '2 seats', '1 sending inbox', 'Telegram alerts'] },
  { id: 3, name: 'Growth',  priceInr: 6999, features: ['68 leads / day', '5 seats', '3 sending inboxes', 'Priority support', 'API access'], popular: true },
  { id: 4, name: 'Agency',  priceInr: 14999, features: ['Unlimited leads', '10 seats', '10 inboxes', 'Custom integrations', 'Dedicated CSM'] },
]

interface Props { onSelectPlan: (planId: number) => void }

export function PaywallPage({ onSelectPlan }: Props) {
  return (
    <div
      className="rdr-scroll"
      style={{
        height: '100vh',
        background: 'var(--bg-deep)',
        padding: '40px 24px',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
        <RadarLogo size={28} withTagline sweep />
      </div>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <Badge tone="amber" size="md" icon="warning">Trial ended</Badge>
      </div>
      <h1
        style={{
          textAlign: 'center',
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: '-0.025em',
          marginTop: 14,
          marginBottom: 10,
          color: 'var(--text-1)',
        }}
      >
        Pick a plan to keep going
      </h1>
      <p
        style={{
          textAlign: 'center',
          fontSize: 14,
          color: 'var(--text-2)',
          maxWidth: 520,
          margin: '0 auto 8px',
          lineHeight: 1.6,
        }}
      >
        Your leads, settings, and configured inboxes are all preserved. Pick up exactly where you left off.
      </p>
      <div
        style={{
          textAlign: 'center',
          marginBottom: 36,
          fontSize: 11.5,
          color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        Workspace paused — billing required to resume
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
          maxWidth: 980,
          margin: '0 auto',
        }}
      >
        {PLANS.map((p) => (
          <div
            key={p.id}
            style={{
              position: 'relative',
              background: 'var(--bg-surface)',
              border: `1px solid ${p.popular ? 'var(--green)' : 'var(--border)'}`,
              borderRadius: 14,
              padding: 28,
              boxShadow: p.popular
                ? '0 0 0 3px rgba(16,185,129,0.12), var(--shadow-lg)'
                : 'var(--shadow-sm)',
            }}
          >
            {p.popular && (
              <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)' }}>
                <Badge tone="green" size="md" icon="sparkle">Most popular</Badge>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <PlanBadge plan={p.name} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 18 }}>
              <span
                style={{
                  fontSize: 36,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                  color: 'var(--text-1)',
                }}
              >
                ₹{p.priceInr.toLocaleString('en-IN')}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-3)' }}>/mo</span>
            </div>
            <div
              style={{
                marginTop: 18,
                paddingTop: 18,
                borderTop: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {p.features.map((f) => (
                <div
                  key={f}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 13,
                    color: 'var(--text-2)',
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: 'var(--green-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="check" size={11} color="var(--green-bright)" style={{ strokeWidth: 2.5 }} />
                  </div>
                  {f}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24 }}>
              <Button
                kind={p.popular ? 'primary' : 'secondary'}
                full
                size="lg"
                onClick={() => onSelectPlan(p.id)}
              >
                Choose {p.name}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 36,
          textAlign: 'center',
          fontSize: 12,
          color: 'var(--text-3)',
        }}
      >
        Questions? Email{' '}
        <span style={{ color: 'var(--green-bright)', fontFamily: 'var(--font-mono)' }}>
          darshan@simpleinc.in
        </span>
      </div>
    </div>
  )
}
