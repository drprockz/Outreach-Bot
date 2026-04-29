import Icon from '../radar/Icon'

interface Props { graceEndsAt: string; onUpdate: () => void }

export function GraceBanner({ graceEndsAt, onUpdate }: Props) {
  const days = Math.max(0, Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / 86400000))
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 18px',
        background: 'var(--red-dim)',
        borderBottom: '1px solid #fecaca',
        fontSize: 12.5,
      }}
    >
      <Icon name="warning" size={14} color="var(--red)" />
      <span style={{ color: '#7f1d1d' }}>
        <strong style={{ color: '#991b1b' }}>Payment failed</strong> — your workspace will be locked in {days} day{days !== 1 ? 's' : ''}.
      </span>
      <button
        onClick={onUpdate}
        style={{
          background: 'var(--red)',
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
        }}
      >
        Update payment <Icon name="arrowRight" size={11} color="#fff" />
      </button>
    </div>
  )
}
