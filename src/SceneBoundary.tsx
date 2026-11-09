import { Component } from 'react'
import type { ReactNode } from 'react'

export class SceneBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Game scene failed to load', error)
    this.props.onError()
  }

  render() {
    if (this.state.error) return <div className="scene-error" role="alert">
      <p>Game assets could not load. Reload the game to retry.</p>
      <button className="primary-button" data-hand-action onClick={() => window.location.reload()}>RELOAD GAME</button>
    </div>
    return this.props.children
  }
}
