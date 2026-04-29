import Icon from '../radar/Icon'

interface Props { daysLeft: number; onUpgrade: () => void; onDismiss?: () => void }

export function TrialBanner({ daysLeft, onUpgrade, onDismiss }: Props) {
  if (daysLeft > 8) return null
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 18px',
        background: 'var(--amber-dim)',
        borderBottom: '1px solid #fde68a',
        fontSize: 12.5,
      }}
    >
      <Icon name="bolt" size={14} color="var(--amber)" />
      <span style={{ color: '#78350f' }}>
        <strong style={{ color: '#92400e' }}>
          {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
        </strong>{' '}
        on your Trial — upgrade to keep your leads flowing.
      </span>
      <button
        onClick={onUpgrade}
        style={{
          background: 'var(--amber)',
          color: '#fff',
          border: 0,
          padding: '4px 12px',
          borderRadius: 5,
          fontSize: 11.5,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
        }}
      >
        Upgrade now <Icon name="arrowRight" size={11} color="#fff" />
      </button>
      <span style={{ flex: 1 }} />
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss banner"
          style={{ background: 'transparent', border: 0, color: '#92400e', cursor: 'pointer', padding: 4 }}
        >
          <Icon name="x" size={13} color="#92400e" />
        </button>
      )}
    </div>
  )
}
