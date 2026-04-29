import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthShell from '@/components/radar/AuthShell'
import Icon from '@/components/radar/Icon'
import { Badge, Button, Input, Select } from '@/components/radar/RadarUI'

interface Invite { email: string; role: string }

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [orgName, setOrgName] = useState('Mehta & Co.')
  const [invites, setInvites] = useState<Invite[]>([])
  const [newEmail, setNewEmail] = useState('')

  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'your-slug'
  const labels = ['Workspace', 'Team', 'Done']

  const addInvite = () => {
    if (!newEmail) return
    setInvites([...invites, { email: newEmail, role: 'Admin' }])
    setNewEmail('')
  }

  return (
    <AuthShell width={540}>
      <div style={{ padding: '36px 44px 32px' }}>
        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
          {[1, 2, 3].map((n) => {
            const isCurrent = n === step
            const isPast = n < step
            return (
              <React.Fragment key={n}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: isPast ? 'var(--green)' : isCurrent ? 'var(--bg-surface)' : 'var(--bg-tint)',
                    border: `1.5px solid ${isPast ? 'var(--green)' : isCurrent ? 'var(--green)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 600,
                    color: isPast ? '#fff' : isCurrent ? 'var(--green-bright)' : 'var(--text-3)',
                    fontFamily: 'var(--font-mono)',
                    boxShadow: isCurrent ? 'var(--ring-accent)' : 'none',
                    transition: 'all 0.18s',
                  }}>
                    {isPast ? <Icon name="check" size={13} color="#fff" style={{ strokeWidth: 2.5 }} /> : n}
                  </div>
                  <div>
                    <div style={{
                      fontSize: 12, fontWeight: 500,
                      color: isCurrent || isPast ? 'var(--text-1)' : 'var(--text-3)',
                    }}>{labels[n - 1]}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                      Step {n} of 3
                    </div>
                  </div>
                </div>
                {n < 3 && (
                  <div style={{
                    flex: 1, height: 2,
                    background: isPast ? 'var(--green)' : 'var(--border)',
                    margin: '0 14px', borderRadius: 1,
                    transition: 'background 0.2s',
                  }} />
                )}
              </React.Fragment>
            )
          })}
        </div>

        {step === 1 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, marginBottom: 8 }}>
              What do you call your agency?
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, marginBottom: 24 }}>
              This becomes your workspace name. You can change it later in settings.
            </p>
            <Input
              full
              label="Agency name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
            <div style={{
              marginTop: 12, padding: '12px 14px',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <Icon name="external" size={13} color="var(--text-3)" />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
                radar.simpleinc.cloud/org/
                <span style={{ color: 'var(--green-bright)', fontWeight: 600 }}>{slug}</span>
              </span>
              <span style={{ marginLeft: 'auto' }}>
                <Badge tone="green" size="sm" icon="check">Available</Badge>
              </span>
            </div>
            <div style={{ marginTop: 28, display: 'flex', justifyContent: 'flex-end' }}>
              <Button kind="primary" iconRight="arrowRight" onClick={() => setStep(2)}>Continue</Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, marginBottom: 8 }}>
              Invite your team
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, marginBottom: 22 }}>
              Bring teammates into your workspace. They'll get an email invite.
            </p>

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Input
                full
                label="Email address"
                placeholder="teammate@yourdomain.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <div style={{ width: 110 }}>
                <Select
                  full
                  label="Role"
                  value="admin"
                  onChange={() => {}}
                  options={[{ value: 'admin', label: 'Admin' }]}
                />
              </div>
              <Button kind="secondary" icon="plus" onClick={addInvite}>Add</Button>
            </div>

            {invites.length > 0 && (
              <div style={{
                marginTop: 16,
                border: '1px solid var(--border)',
                borderRadius: 10,
                overflow: 'hidden',
                background: 'var(--bg-surface)',
              }}>
                {invites.map((inv, i) => (
                  <div
                    key={inv.email}
                    style={{
                      display: 'flex', alignItems: 'center',
                      padding: '10px 14px',
                      borderBottom: i < invites.length - 1 ? '1px solid var(--border)' : 0,
                      gap: 12,
                    }}
                  >
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--green), var(--cyan))',
                      color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', flexShrink: 0,
                    }}>
                      {inv.email.slice(0, 2).toUpperCase()}
                    </div>
                    <span style={{ flex: 1, fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--text-1)' }}>
                      {inv.email}
                    </span>
                    <Badge tone="neutral" size="sm">{inv.role}</Badge>
                    <Badge tone="amber" size="sm" dot>Pending</Badge>
                    <button
                      onClick={() => setInvites(invites.filter((_, x) => x !== i))}
                      style={{ background: 'transparent', border: 0, color: 'var(--text-3)', cursor: 'pointer', padding: 2 }}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{
              marginTop: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <Button kind="ghost" icon="arrowLeft" onClick={() => setStep(1)}>Back</Button>
              <div style={{ display: 'flex', gap: 10 }}>
                <Button kind="ghost" onClick={() => setStep(3)}>Skip for now</Button>
                <Button kind="primary" iconRight="arrowRight" onClick={() => setStep(3)}>Continue</Button>
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{
                display: 'inline-flex', width: 64, height: 64, borderRadius: '50%',
                background: 'var(--green-dim)',
                border: '1px solid var(--green-line)',
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 16, position: 'relative',
              }}>
                <Icon name="check" size={28} color="var(--green-bright)" style={{ strokeWidth: 2.5 }} />
                <span style={{
                  position: 'absolute', inset: -6, borderRadius: '50%',
                  border: '1px solid var(--green-line)', opacity: 0.5,
                }} />
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, marginBottom: 8 }}>
                You're all set
              </h1>
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>
                Your workspace is live and ready to start finding leads.
              </p>
            </div>

            <div style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 6,
            }}>
              {[
                { label: 'Workspace created', sub: `radar.simpleinc.cloud/org/${slug}` },
                { label: 'Trial started', sub: 'Started just now' },
                { label: '14 days free', sub: 'Full access — no credit card' },
              ].map((c, i) => (
                <div
                  key={c.label}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 12px', borderRadius: 8,
                    background: 'var(--bg-surface)',
                    marginBottom: i < 2 ? 4 : 0,
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: 'var(--green)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name="check" size={12} color="#fff" style={{ strokeWidth: 2.5 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text-1)', fontWeight: 500 }}>{c.label}</div>
                    <div style={{
                      fontSize: 11, color: 'var(--text-3)',
                      fontFamily: 'var(--font-mono)', marginTop: 1,
                    }}>{c.sub}</div>
                  </div>
                  <Badge tone="green" size="sm">Done</Badge>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 24 }}>
              <Button kind="primary" full size="lg" iconRight="arrowRight" onClick={() => navigate('/')}>
                Go to Dashboard
              </Button>
            </div>
            <p style={{ marginTop: 12, textAlign: 'center', fontSize: 11.5, color: 'var(--text-3)' }}>
              Tip: Set up your{' '}
              <span style={{ color: 'var(--green-bright)' }}>ICP</span>{' '}
              first to get the best lead matches.
            </p>
          </>
        )}
      </div>
    </AuthShell>
  )
}
