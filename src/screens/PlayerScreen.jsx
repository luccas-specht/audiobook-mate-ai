import { useEffect, useRef, useState } from 'react'
import { AudioPlayer } from '../lib/audioPlayer.js'
import { loadResumePosition } from '../lib/db.js'
import { processor } from '../lib/pageProcessor.js'

function fmt(sec) {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function PlayerScreen({ book, autoPlay = false, onBack }) {
  const playerRef              = useRef(null)
  const [playing, setPlaying]  = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [elapsed, setElapsed]  = useState(0)
  const [total, setTotal]      = useState(0)
  const [currentPage, setCurrentPage] = useState(book.startPage ?? 1)
  const [procStatus, setProcStatus]   = useState(() => processor.status)

  useEffect(() => processor.onStatus(setProcStatus), [])

  useEffect(() => {
    let player
    let cancelled = false

    loadResumePosition(book.id, book.startPage ?? 1, book.endPage ?? book.totalPages).then(({ pageNumber, position }) => {
      if (cancelled) return
      setCurrentPage(pageNumber)

      player = new AudioPlayer(
        book.id,
        pageNumber,
        position,
        book.endPage ?? book.totalPages,
        {
          onPage:      (n)        => setCurrentPage(n),
          onProgress:  (sec, dur) => { setElapsed(sec); setTotal(dur) },
          onBuffering: setBuffering,
          onEnd:       ()         => setPlaying(false),
        },
      )
      playerRef.current = player

      if (autoPlay) {
        setPlaying(true)
        setBuffering(true)
        player.play()
      }
    })

    return () => {
      cancelled = true
      player?.destroy()
    }
  }, [book])

  async function toggle() {
    const p = playerRef.current
    if (!p) return
    if (playing) {
      p.pause()
      setPlaying(false)
    } else {
      setPlaying(true)
      setBuffering(true)
      await p.play()
    }
  }

  const pct       = total ? (elapsed / total) * 100 : 0
  const remaining = Math.max(0, total - elapsed)

  return (
    <div className="screen player">
      <header className="player-top">
        <button className="icon-btn ghost" onClick={onBack} aria-label="Voltar">⌄</button>
      </header>

      <div className="cover-wrap">
        {book.cover ? (
          <img className="cover" src={book.cover} alt={`Capa de ${book.title}`} />
        ) : (
          <div className="cover cover-fallback">{book.title}</div>
        )}
      </div>

      <h2 className="book-title">{book.title}</h2>

      <p className="muted" style={{ textAlign: 'center', fontSize: '0.8rem', marginTop: '0.25rem' }}>
        Página {currentPage} de {book.totalPages}
      </p>

      <div className="progress">
        <div className="track">
          <div className="track-fill" style={{ width: `${pct}%` }} />
          <div className="track-thumb" style={{ left: `${pct}%` }} />
        </div>
        <div className="times">
          <span>{fmt(elapsed)}</span>
          <span className="muted">{fmt(remaining)} restante</span>
          <span>-{fmt(total)}</span>
        </div>
      </div>

      <div className="controls">
        <button
          className="icon-btn skip"
          onClick={() => playerRef.current?.seek(-15)}
          aria-label="Voltar 15 segundos"
        >
          <span aria-hidden>↺</span>
          <span className="skip-num">15</span>
        </button>

        <button className="play-btn" onClick={toggle} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
          {buffering ? '…' : playing ? '❚❚' : '▶'}
        </button>

        <button
          className="icon-btn skip"
          onClick={() => playerRef.current?.seek(30)}
          aria-label="Avançar 30 segundos"
        >
          <span aria-hidden>↻</span>
          <span className="skip-num">30</span>
        </button>
      </div>

      <p className="footnote muted">
        {procStatus || 'Vozes masculina e feminina · narração e diálogos'}
      </p>
    </div>
  )
}
