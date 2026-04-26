import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { verifyOtp } from '@/lib/auth'

interface OtpState { email: string }

export default function Otp() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state ?? {}) as OtpState
  const email = state.email ?? ''

  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleVerify = async () => {
    if (code.length !== 6) return
    setLoading(true)
    setError('')
    try {
      await verifyOtp(email, code)
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!email) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p>No email in session.</p>
          <Button onClick={() => navigate('/login')}>Back to login</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa' }}>
      <div style={{ width: '100%', maxWidth: 380, padding: 32, background: 'white', borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.08)' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>Check your email</h1>
        <p style={{ fontSize: 14, color: '#64748b', marginTop: 8, marginBottom: 20 }}>
          We sent a 6-digit code to <strong>{email}</strong>
        </p>

        <Input
          placeholder="000000"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          style={{ letterSpacing: 4, textAlign: 'center', fontSize: 18 }}
        />

        {error && <p style={{ color: '#dc2626', fontSize: 14, marginTop: 12 }}>{error}</p>}

        <Button
          className="w-full"
          onClick={handleVerify}
          disabled={code.length !== 6 || loading}
          style={{ marginTop: 16 }}
        >
          {loading ? 'Verifying...' : 'Verify'}
        </Button>
      </div>
    </div>
  )
}
