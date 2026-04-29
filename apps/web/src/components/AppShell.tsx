import { Outlet, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useAuth } from './AuthGate'
import { TrialBanner } from './billing/TrialBanner'
import { GraceBanner } from './billing/GraceBanner'

function trialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null
  const ms = new Date(trialEndsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

export default function AppShell() {
  const { subscription } = useAuth()
  const navigate = useNavigate()

  const daysLeft = trialDaysLeft(subscription.trialEndsAt)
  const showTrial = subscription.status === 'trial' && daysLeft !== null && daysLeft <= 8
  const showGrace = subscription.status === 'grace' && !!subscription.graceEndsAt

  const goToBilling = () => navigate('/settings/billing')

  return (
    <div className="rdr-app-shell">
      <Sidebar />
      <div className="rdr-main">
        {showTrial && daysLeft !== null && (
          <TrialBanner daysLeft={daysLeft} onUpgrade={goToBilling} />
        )}
        {showGrace && subscription.graceEndsAt && (
          <GraceBanner graceEndsAt={subscription.graceEndsAt} onUpdate={goToBilling} />
        )}
        <div className="rdr-page-body rdr-scroll">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
