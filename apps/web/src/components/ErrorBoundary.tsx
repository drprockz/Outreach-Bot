import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null; errorId: string | null }

/**
 * App-level error boundary. Catches any uncaught render error and shows a
 * friendly fallback instead of a white screen. Errors are logged to the
 * console (and to Sentry if/when wired up).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorId: null }

  static getDerivedStateFromError(error: Error): State {
    // Generate a short id the user can quote back to support
    const errorId = Math.random().toString(36).slice(2, 8).toUpperCase()
    return { error, errorId }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.state.errorId, error, info.componentStack)
    // TODO(sweep-4-followup): forward to Sentry / Datadog when wired.
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: '#fef2f2', padding: 32, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          <div style={{
            maxWidth: 480, background: 'white', padding: 32, borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>💥</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 8px 0' }}>Something went wrong</h1>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
              An unexpected error crashed this page. It's been logged. If this keeps happening, contact support and quote error&nbsp;ID
              <strong style={{ marginLeft: 4, fontFamily: 'SF Mono, Menlo, Consolas, monospace' }}>{this.state.errorId}</strong>.
            </p>
            <details style={{ textAlign: 'left', fontSize: 12, color: '#94a3b8', marginBottom: 24 }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Technical details</summary>
              <pre style={{
                background: '#f1f5f9', padding: 12, borderRadius: 6, overflow: 'auto', maxHeight: 200,
                fontSize: 11, lineHeight: 1.4,
              }}>{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
            </details>
            <button
              onClick={() => { window.location.href = '/' }}
              style={{
                background: '#0f172a', color: 'white', border: 'none', padding: '10px 20px',
                borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
              }}
            >
              Go to home
            </button>
            <button
              onClick={() => { this.setState({ error: null, errorId: null }) }}
              style={{
                marginLeft: 8, background: 'white', color: '#0f172a', border: '1px solid #e2e8f0', padding: '10px 20px',
                borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
