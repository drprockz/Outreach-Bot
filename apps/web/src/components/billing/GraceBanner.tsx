interface Props { graceEndsAt: string; onUpdate: () => void }

export function GraceBanner({ graceEndsAt, onUpdate }: Props) {
  const days = Math.max(0, Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / 86400000))
  return (
    <div
      role="alert"
      style={{
        background: '#fef2f2',
        borderBottom: '1px solid #fecaca',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 14,
      }}
    >
      <span style={{ color: '#991b1b' }}>
        ⚠️ Payment failed — {days} day{days !== 1 ? 's' : ''} to update billing before access is suspended
      </span>
      <button
        onClick={onUpdate}
        style={{
          background: 'none', border: 'none', color: '#7f1d1d',
          fontWeight: 500, textDecoration: 'underline', cursor: 'pointer', marginLeft: 16,
        }}
      >
        Update payment →
      </button>
    </div>
  )
}
