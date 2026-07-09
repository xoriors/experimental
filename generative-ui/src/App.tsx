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
      <nav className="mode-bar">
        <button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>
          Live (Gemini)
        </button>
        <button className={mode === 'mock' ? 'active' : ''} onClick={() => setMode('mock')}>
          Mock demo
        </button>
      </nav>
      {mode === 'live' ? <LiveChat /> : <MockDemo />}
    </>
  )
}
