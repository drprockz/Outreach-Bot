import { useNavigate } from 'react-router-dom'
import Icon from '@/components/radar/Icon'
import { Badge, Button, RadarLogo } from '@/components/radar/RadarUI'

const STEPS = [
  { num: '01', title: 'Name your workspace', body: 'Pick an agency name and a URL slug for your team.', icon: 'settings', time: '30 sec' },
  { num: '02', title: 'Invite teammates', body: 'Bring colleagues in as Admins. Optional — you can do this later.', icon: 'users', time: '1 min' },
  { num: '03', title: 'Start finding leads', body: 'Define your niche and ICP, then watch the engines work.', icon: 'radar', time: '2 min' },
]

export default function Welcome() {
  const navigate = useNavigate()

  return (
    <div className="rdr-scroll" style={{ height: '100vh', overflow: 'auto', background: 'var(--bg-deep)' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '56px 32px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
          <RadarLogo size={26} withTagline sweep />
        </div>

        <div style={{ textAlign: 'center', maxWidth: 580, margin: '0 auto' }}>
          <Badge tone="green" size="md" icon="sparkle">Welcome aboard</Badge>
          <h1 style={{
            marginTop: 16, fontSize: 36, fontWeight: 600,
            letterSpacing: '-0.025em', lineHeight: 1.1,
            color: 'var(--text-1)',
          }}>
            Let's get your outreach<br />engines running
          </h1>
          <p style={{ marginTop: 14, fontSize: 14.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
            Three quick steps to set up your workspace, invite your team, and find your first batch of leads. Takes about 4 minutes.
          </p>
        </div>

        <div style={{ marginTop: 40, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {STEPS.map((s) => (
            <div
              key={s.num}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 22,
                boxShadow: 'var(--shadow-sm)',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--green-dim)',
                  border: '1px solid var(--green-line)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name={s.icon} size={18} color="var(--green-bright)" />
                </div>
                <span style={{
                  fontSize: 11, color: 'var(--text-3)',
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
                }}>{s.num}</span>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 14 }}>{s.body}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)' }}>
                <Icon name="clock" size={11} />
                <span style={{ fontFamily: 'var(--font-mono)' }}>{s.time}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 32, padding: 24,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'linear-gradient(135deg, var(--green), var(--cyan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}>
              <Icon name="bolt" size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
                Your 14-day trial is active
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>
                34 leads/day · 1 seat · Full access — no credit card needed
              </div>
            </div>
          </div>
          <Button kind="primary" size="lg" iconRight="arrowRight" onClick={() => navigate('/onboarding')}>
            Get started
          </Button>
        </div>

        <div style={{
          marginTop: 28, textAlign: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 18, fontSize: 11.5, color: 'var(--text-3)',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="shield" size={12} /> SOC 2 ready
          </span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-3)' }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="lock" size={12} /> GDPR compliant
          </span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-3)' }} />
          <span>Cancel anytime — keep your data</span>
        </div>
      </div>
    </div>
  )
}
