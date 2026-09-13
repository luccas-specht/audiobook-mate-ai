import { useEffect, useState } from 'react'
import { processor } from '../lib/pageProcessor.js'
import { loadPage } from '../lib/db.js'

const PREBUFFER = 4   // pages to fully process before allowing playback to start

export default function ConfirmScreen({ book, onStart, onBack }) {
  const [loading, setLoading]         = useState(false)
  const [procStatus, setProcStatus]   = useState(() => processor.status)
  const [bufferReady, setBufferReady] = useState(0)
  const [bufferTotal, setBufferTotal] = useState(0)

  useEffect(() => processor.onStatus(setProcStatus), [])

  async function handleStart() {
    setLoading(true)

    const total = Math.min(PREBUFFER, book.endPage - book.startPage + 1)
    const pages = Array.from({ length: total }, (_, i) => book.startPage + i)
    setBufferTotal(total)

    const readySet = new Set()
    let transitioned = false

    // Subscribe BEFORE checking existing state to avoid missing events.
    const unsub = processor.onPageReady((bookId, pageNumber) => {
      if (transitioned || bookId !== book.id) return
      if (!pages.includes(pageNumber)) return
      readySet.add(pageNumber)
      setBufferReady(readySet.size)
      if (readySet.size >= total) {
        transitioned = true
        unsub()
        onStart()
      }
    })

    // Seed with pages already processed in a previous session.
    for (const p of pages) {
      const page = await loadPage(book.id, p)
      if (page?.status === 'ready') readySet.add(p)
    }
    setBufferReady(readySet.size)

    if (!transitioned && readySet.size >= total) {
      transitioned = true
      unsub()
      onStart()
      return
    }

    // Enqueue the full pre-buffer — processor runs MAX_CONCURRENT at a time.
    for (const p of pages) {
      processor.enqueue(book.id, p)
    }
  }

  const pagesLabel = book.endPage < book.totalPages
    ? `${book.endPage - book.startPage + 1} páginas (prévia) · total ${book.totalPages}`
    : `${book.totalPages} páginas`

  const pct = bufferTotal > 0 ? (bufferReady / bufferTotal) * 100 : 0

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
        {pagesLabel}
      </p>

      <div style={{ marginTop: '2.5rem', textAlign: 'center' }}>
        {loading ? (
          <>
            <div className="bar" style={{ margin: '0 auto 0.75rem', maxWidth: '240px' }}>
              {bufferTotal > 0 ? (
                <div
                  className="bar-fill"
                  style={{ width: `${pct}%`, transition: 'width 0.4s ease' }}
                />
              ) : (
                <div className="bar-fill bar-fill--pulse" style={{ width: '100%' }} />
              )}
            </div>
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              {bufferTotal > 0
                ? `Preparando página ${bufferReady} de ${bufferTotal}…`
                : 'Preparando áudio…'}
            </p>
            {procStatus && (
              <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {procStatus}
              </p>
            )}
          </>
        ) : (
          <button className="btn-primary" onClick={handleStart}>
            Começar Leitura
          </button>
        )}
      </div>

      <p className="footnote muted">
        O áudio é gerado por IA · vozes masculina e feminina
      </p>
    </div>
  )
}
