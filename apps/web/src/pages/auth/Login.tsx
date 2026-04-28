import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sendOtp, googleLoginUrl } from '@/lib/auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleOtp = async () => {
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa' }}>
      <div style={{ width: '100%', maxWidth: 380, padding: 32, background: 'white', borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.08)' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>Sign in to Radar</h1>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>Your outreach intelligence engine</p>
        </div>

        <Button
          className="w-full"
          variant="outline"
          onClick={() => { window.location.href = googleLoginUrl() }}
          style={{ marginBottom: 20 }}
        >
          Continue with Google
        </Button>

        <div style={{ position: 'relative', textAlign: 'center', margin: '20px 0', color: '#94a3b8', fontSize: 12, textTransform: 'uppercase' }}>
          <span style={{ background: 'white', padding: '0 12px', position: 'relative', zIndex: 1 }}>Or</span>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: '#e2e8f0', zIndex: 0 }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <p style={{ color: '#dc2626', fontSize: 14, margin: 0 }}>{error}</p>}
          <Button
            className="w-full"
            onClick={handleOtp}
            disabled={!email || loading}
          >
            {loading ? 'Sending...' : 'Send OTP'}
          </Button>
        </div>
      </div>
    </div>
  )
}
