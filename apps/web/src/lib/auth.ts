const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export async function sendOtp(email: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
    credentials: 'include',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
}

export async function verifyOtp(email: string, code: string): Promise<{ token: string }> {
  const res = await fetch(`${API_URL}/api/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
    credentials: 'include',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Verification failed (${res.status})`)
  }
  return (await res.json()) as { token: string }
}

export async function logout(): Promise<void> {
  // Clear client-side state. Server-side revocation is handled by clearing cookie via a future endpoint.
  await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
  window.location.href = '/login'
}

export function googleLoginUrl(): string {
  return `${API_URL}/auth/google`
}
