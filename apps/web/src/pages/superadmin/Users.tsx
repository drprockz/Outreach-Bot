export default function Users() {
  return (
    <div style={{ maxWidth: 1000, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>All Users</h1>
      <div style={{ background: 'white', padding: 24, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <p style={{ color: '#64748b' }}>
          TODO: list users via <code>adminUsers(filter)</code> GraphQL query — email, last login, org membership
        </p>
      </div>
    </div>
  )
}
