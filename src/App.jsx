import { useEffect, useState } from 'react'
import UploadScreen from './screens/UploadScreen.jsx'
import ConfirmScreen from './screens/ConfirmScreen.jsx'
import PlayerScreen from './screens/PlayerScreen.jsx'
import { loadBook, clearBook } from './lib/db.js'
import { processor } from './lib/pageProcessor.js'

export default function App() {
  const [screen, setScreen]   = useState('upload')  // 'upload' | 'confirm' | 'player'
  const [book, setBook]       = useState(null)
  const [autoPlay, setAutoPlay] = useState(false)
  const [ready, setReady]     = useState(false)

  // Restore session: if a book exists, land on the confirm screen.
  useEffect(() => {
    loadBook('current').then((b) => {
      if (b) { setBook(b); setScreen('confirm') }
      setReady(true)
    })
  }, [])

  async function handleBack() {
    processor.cancelBook('current')
    await clearBook('current')
    setBook(null)
    setScreen('upload')
    setAutoPlay(false)
  }

  function handleBookReady(b) {
    setBook(b)
    setScreen('confirm')
  }

  function handleStart() {
    setAutoPlay(true)
    setScreen('player')
  }

  if (!ready) return <div className="screen center muted">Carregando…</div>

  return (
    <div className="app">
      {screen === 'player' ? (
        <PlayerScreen book={book} autoPlay={autoPlay} onBack={() => setScreen('confirm')} />
      ) : screen === 'confirm' ? (
        <ConfirmScreen book={book} onStart={handleStart} onBack={handleBack} />
      ) : (
        <UploadScreen onReady={handleBookReady} />
      )}
    </div>
  )
}
