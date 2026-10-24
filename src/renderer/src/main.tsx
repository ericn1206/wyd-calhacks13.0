import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string }> {
  state = { message: '' }

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || 'Something went wrong' }
  }

  render() {
    if (!this.state.message) return this.props.children
    return (
      <div style={{ padding: 32, color: '#fca5a5', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ marginTop: 0 }}>Lock In hit an error and the screen went blank.</p>
        <p>{this.state.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff' }}
        >
          Reload
        </button>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
