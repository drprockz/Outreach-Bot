import { Button } from '@/components/ui/button'

export default function Org() {
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Organization Settings</h1>
      <div style={{ background: 'white', padding: 24, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <p style={{ color: '#64748b', marginBottom: 16 }}>
          Organization name, slug, timezone, and account deletion. (TODO: wire to GraphQL when resolvers exist)
        </p>
        <Button variant="destructive" disabled>Delete organization</Button>
      </div>
    </div>
  )
}
