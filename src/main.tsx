import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[#0d1117] p-8 text-[#c9d1d9]">
          <div className="max-w-xl rounded border border-red-900/70 bg-[#161b22] p-6 font-mono">
            <div className="text-sm tracking-[0.2em] text-red-300">
              RIPPLE ALERT · APPLICATION ERROR
            </div>
            <p className="mt-3 text-xs text-[#c9d1d9]">
              A runtime error stopped the interface from rendering.
            </p>
            <p className="mt-3 break-words text-[10px] text-red-200/80">
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded border border-[#58a6ff]/60 px-3 py-2 text-[10px] tracking-widest text-[#79c0ff]"
            >
              RELOAD APPLICATION
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
