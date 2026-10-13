import { Component } from 'react';

/**
 * Prevents uncaught render/hydrate errors from leaving #root permanently empty.
 */
export class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('EYRA UI crashed:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      const message = this.state.error?.message || String(this.state.error);
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: '2rem',
            background: '#0f1419',
            color: '#e8eef4',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>EYRA hit a UI error</h1>
          <p style={{ opacity: 0.8, marginBottom: '1rem' }}>
            The previous blank-screen failure is now caught. Reload to continue.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#1a222c',
              padding: '1rem',
              borderRadius: 8,
              marginBottom: '1rem',
            }}
          >
            {message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: '#35d6f2',
              color: '#042028',
              border: 0,
              borderRadius: 6,
              padding: '0.5rem 1rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
