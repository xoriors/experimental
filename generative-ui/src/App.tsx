import { useState } from 'react'
import LiveChat from './LiveChat'
import MockDemo from './MockDemo'

// Two ways to run the same rendering pipeline:
// live, where Gemini decides when to spawn a form (needs the runtime and a
// GEMINI_API_KEY), and mock, a scripted agent that works offline.

type Mode = 'live' | 'mock'

export default function App() {
  const [mode, setMode] = useState<Mode>('live')

  return (
    <>
      <nav className="mode-bar" aria-label="Demo mode">
        <div className={`mode-track mode-${mode}`}>
          <button
            className={mode === 'live' ? 'active' : ''}
            aria-pressed={mode === 'live'}
            onClick={() => setMode('live')}
          >
            Live (Gemini)
          </button>
          <button
            className={mode === 'mock' ? 'active' : ''}
            aria-pressed={mode === 'mock'}
            onClick={() => setMode('mock')}
          >
            Mock demo
          </button>
        </div>
      </nav>
      {mode === 'live' ? <LiveChat /> : <MockDemo />}
    </>
  )
}
