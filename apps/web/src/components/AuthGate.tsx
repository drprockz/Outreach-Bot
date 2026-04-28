import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { PaywallPage } from '@/components/billing/PaywallPage'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export type OrgStatus = 'trial' | 'active' | 'locked' | 'suspended'
export type SubscriptionStatus = 'trial' | 'active' | 'grace' | 'locked' | 'cancelled'

export interface AuthUser {
  id: number
  email: string
  isSuperadmin: boolean
}

export interface AuthOrg {
  id: number
  name: string
  slug: string
  status: OrgStatus
}

export interface AuthPlan {
  id: number
  name: string
}

export interface AuthSubscription {
  status: SubscriptionStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  graceEndsAt: string | null
}

export interface AuthContextValue {
  user: AuthUser
  org: AuthOrg
  plan: AuthPlan
  subscription: AuthSubscription
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthGate>')
  return ctx
}

interface MeResponse {
  user: AuthUser
  org: AuthOrg
  plan: AuthPlan
  subscription: AuthSubscription
}

interface JwtPayload {
  userId: number
  orgId: number
  isSuperadmin: boolean
  role?: string
}

async function fetchMe(): Promise<MeResponse | { unauthorized: true } | { notImplemented: true }> {
  const res = await fetch(`${API_URL}/api/me`, { credentials: 'include' })
  if (res.status === 401) return { unauthorized: true }
  if (res.status === 404) return { notImplemented: true }
  if (!res.ok) throw new Error(`/api/me failed (${res.status})`)
  return (await res.json()) as MeResponse
}

// TODO: remove once backend ships GET /api/me; this synthesises the same shape
// from the existing /auth/google/token + /api/billing/portal endpoints.
async function fetchMeFallback(): Promise<MeResponse | { unauthorized: true }> {
  const tokenRes = await fetch(`${API_URL}/auth/google/token`, { credentials: 'include' })
  if (tokenRes.status === 401) return { unauthorized: true }
  if (!tokenRes.ok) throw new Error(`/auth/google/token failed (${tokenRes.status})`)
  const { token } = (await tokenRes.json()) as { token?: string }
  if (!token) return { unauthorized: true }
  const [, rawPayload] = token.split('.')
  const payload = JSON.parse(atob(rawPayload)) as JwtPayload

  const portalRes = await fetch(`${API_URL}/api/billing/portal`, { credentials: 'include' })
  if (portalRes.status === 401) return { unauthorized: true }
  if (!portalRes.ok) throw new Error(`/api/billing/portal failed (${portalRes.status})`)
  const portal = (await portalRes.json()) as {
    plan: string
    status: SubscriptionStatus
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    graceEndsAt: string | null
  }

  const orgStatus: OrgStatus =
    portal.status === 'locked' || portal.status === 'cancelled' ? 'locked'
      : portal.status === 'trial' ? 'trial'
      : 'active'

  return {
    user: { id: payload.userId, email: '', isSuperadmin: !!payload.isSuperadmin },
    org: { id: payload.orgId, name: '', slug: '', status: orgStatus },
    plan: { id: 0, name: portal.plan },
    subscription: {
      status: portal.status,
      trialEndsAt: portal.trialEndsAt,
      currentPeriodEnd: portal.currentPeriodEnd,
      graceEndsAt: portal.graceEndsAt,
    },
  }
}

interface Props {
  children: ReactNode
}

export default function AuthGate({ children }: Props) {
  const location = useLocation()
  const [state, setState] = useState<MeResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'authed' | 'unauthed' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  const load = async () => {
    setStatus('loading')
    try {
      const primary = await fetchMe()
      if ('unauthorized' in primary) {
        setStatus('unauthed')
        return
      }
      if ('notImplemented' in primary) {
        const fallback = await fetchMeFallback()
        if ('unauthorized' in fallback) {
          setStatus('unauthed')
          return
        }
        setState(fallback)
        setStatus('authed')
        return
      }
      setState(primary)
      setStatus('authed')
    } catch (err) {
      setErrorMsg((err as Error).message)
      setStatus('error')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status === 'loading') {
    return <div style={{ padding: 32, color: '#64748b' }}>Loading…</div>
  }

  if (status === 'unauthed') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (status === 'error' || !state) {
    return <div style={{ padding: 32, color: '#dc2626' }}>Auth error: {errorMsg}</div>
  }

  if (state.org.status === 'locked' || state.subscription.status === 'locked') {
    return <PaywallPage onSelectPlan={() => { window.location.href = '/settings/billing' }} />
  }

  const value: AuthContextValue = {
    user: state.user,
    org: state.org,
    plan: state.plan,
    subscription: state.subscription,
    refresh: load,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
