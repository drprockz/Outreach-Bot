import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthGate'

export default function RequireSuperadmin() {
  const { user } = useAuth()
  if (!user.isSuperadmin) return <Navigate to="/" replace />
  return <Outlet />
}
