import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AuthShell from '@/components/radar/AuthShell'
import Icon from '@/components/radar/Icon'
import { Button } from '@/components/radar/RadarUI'
import { verifyOtp } from '@/lib/auth'

interface OtpState { email: string }

export default function Otp() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state ?? {}) as OtpState
  const email = state.email ?? ''

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(48)
  const refs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  const code = digits.join('')

  const handleVerify = async (full: string) => {
    if (full.length !== 6 || loading) return
    setLoading(true)
    setError('')
    try {
      await verifyOtp(email, full)
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const setDigit = (i: number, v: string) => {
    const cleaned = v.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = cleaned
    setDigits(next)
    if (cleaned && i < 5) refs.current[i + 1]?.focus()
    if (next.every((d) => d) && !error) void handleVerify(next.join(''))
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      e.preventDefault()
      const next = pasted.split('')
      setDigits(next)
      void handleVerify(pasted)
    }
  }

  if (!email) {
    return (
      <AuthShell>
        <div style={{ padding: '40px 40px 28px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 20 }}>No email in session.</p>
          <Button kind="primary" full onClick={() => navigate('/login')}>Back to login</Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <div style={{ padding: '40px 40px 28px' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'var(--green-dim)',
          border: '1px solid var(--green-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 18,
        }}>
          <Icon name="mail" size={20} color="var(--green-bright)" />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, marginBottom: 8 }}>
          Check your email
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, marginBottom: 28 }}>
          We sent a 6-digit code to{' '}
          <span style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{email}</span>
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el }}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus()
              }}
              maxLength={1}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus={i === 0}
              style={{
                flex: 1, height: 56, textAlign: 'center',
                background: 'var(--bg-input)',
                border: `1.5px solid ${error ? 'var(--red)' : d ? 'var(--green-line)' : 'var(--border-light)'}`,
                borderRadius: 10,
                color: error ? 'var(--red)' : 'var(--text-1)',
                fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)',
                outline: 'none',
                boxShadow: error ? 'var(--ring-error)' : d ? 'var(--ring-accent)' : 'none',
                transition: 'all 0.12s',
              }}
            />
          ))}
        </div>

        {error && (
          <div style={{
            padding: '10px 12px',
            background: 'var(--red-dim)',
            border: '1px solid var(--red-soft)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--red)',
            marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Icon name="warning" size={13} color="var(--red)" /> {error}
          </div>
        )}

        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 22 }}>
          {countdown > 0 ? (
            <>Didn't receive it? Resend in <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-1)' }}>{countdown}s</span></>
          ) : (
            <button
              onClick={() => setCountdown(48)}
              style={{
                background: 'none', border: 0, padding: 0, cursor: 'pointer',
                color: 'var(--green-bright)', fontWeight: 500,
              }}
            >
              Resend code
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Button kind="ghost" icon="arrowLeft" onClick={() => navigate('/login')}>
            Use a different email
          </Button>
          <span style={{ flex: 1 }} />
          <Button
            kind="primary"
            iconRight="arrowRight"
            onClick={() => handleVerify(code)}
            disabled={code.length !== 6 || loading}
          >
            {loading ? 'Verifying…' : 'Verify'}
          </Button>
        </div>
      </div>
    </AuthShell>
  )
}
