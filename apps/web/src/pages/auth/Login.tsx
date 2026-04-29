import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthShell from '@/components/radar/AuthShell'
import Icon from '@/components/radar/Icon'
import { Button, Input } from '@/components/radar/RadarUI'
import { sendOtp, googleLoginUrl } from '@/lib/auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleOtp = async () => {
    if (!email || loading) return
    setLoading(true)
    setError('')
    try {
      await sendOtp(email)
      navigate('/otp', { state: { email } })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <div style={{ padding: '40px 40px 28px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, marginBottom: 8 }}>
          Welcome back
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, marginBottom: 28 }}>
          Sign in to your workspace. First-time? We'll create one for you.
        </p>

        <Button
          kind="secondary"
          full
          size="lg"
          icon="google"
          onClick={() => { window.location.href = googleLoginUrl() }}
        >
          Continue with Google
        </Button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0', color: 'var(--text-3)', fontSize: 11 }}>
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>OR</span>
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <Input
          label="Work email"
          full
          icon="mail"
          placeholder="darshan@simpleinc.in"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error || undefined}
        />

        <div style={{ marginTop: 14 }}>
          <Button
            kind="primary"
            full
            size="lg"
            iconRight="arrowRight"
            onClick={handleOtp}
            disabled={!email || loading}
          >
            {loading ? 'Sending…' : 'Send me a code'}
          </Button>
        </div>

        <div style={{
          marginTop: 16,
          padding: '10px 12px',
          background: 'var(--green-dim)',
          border: '1px solid var(--green-line)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}>
          <Icon name="info" size={13} color="var(--green-bright)" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text-1)' }}>No account needed.</strong> Your first login creates a workspace with a 14-day free trial.
          </div>
        </div>
      </div>
      <div style={{
        padding: '14px 40px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-subtle)',
        textAlign: 'center',
        fontSize: 10.5,
        color: 'var(--text-3)',
      }}>
        By signing in you agree to our{' '}
        <span style={{ color: 'var(--text-2)', textDecoration: 'underline' }}>Terms</span>
        {' '}&{' '}
        <span style={{ color: 'var(--text-2)', textDecoration: 'underline' }}>Privacy</span>
      </div>
    </AuthShell>
  )
}
