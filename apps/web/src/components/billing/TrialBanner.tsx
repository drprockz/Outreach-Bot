interface Props { daysLeft: number; onUpgrade: () => void }

export function TrialBanner({ daysLeft, onUpgrade }: Props) {
  if (daysLeft > 8) return null
  const urgent = daysLeft <= 3
  return (
    <div
      role="status"
      style={{
        background: urgent ? '#fef2f2' : '#fffbeb',
        borderBottom: `1px solid ${urgent ? '#fecaca' : '#fde68a'}`,
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 14,
      }}
    >
      <span style={{ color: urgent ? '#991b1b' : '#92400e' }}>
        ⚡ {daysLeft} day{daysLeft !== 1 ? 's' : ''} left on your trial — upgrade to keep your leads flowing
      </span>
      <button
        onClick={onUpgrade}
        style={{
          background: 'none',
          border: 'none',
          color: urgent ? '#7f1d1d' : '#78350f',
          fontWeight: 500,
          textDecoration: 'underline',
          cursor: 'pointer',
          marginLeft: 16,
        }}
      >
        Upgrade now →
      </button>
    </div>
  )
}
