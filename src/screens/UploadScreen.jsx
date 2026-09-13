import { useRef, useState } from 'react'
import { parsePdf } from '../lib/pdf.js'
import { saveBook, savePage } from '../lib/db.js'
import { detectStart } from '../lib/worker.js'

// Testing: only process this many pages starting from startPage.
// Set to Infinity for production.
const PAGE_LIMIT = 4

export default function UploadScreen({ onReady }) {
  const inputRef = useRef(null)
  const [status, setStatus]     = useState('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError]       = useState('')

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Por favor, escolha um arquivo PDF.')
      setStatus('error')
      return
    }

    setStatus('parsing')
    setError('')
    setProgress(0)

    try {
      // 1 — Extract all pages + cover from PDF
      const { pages, cover, title, numPages } = await parsePdf(file, setProgress)

      // 2 — Persist book stub (startPage/endPage updated below)
      await saveBook({ id: 'current', title, cover, totalPages: numPages, createdAt: Date.now() })

      // 3 — Persist each page as 'pending'
      for (const { pageNumber, text } of pages) {
        await savePage({
          bookId: 'current',
          pageNumber,
          text,
          type: 'other',
          status: 'pending',
          script: null,
          audio: null,
          duration: null,
          playback: { position: 0, completed: false },
          updatedAt: Date.now(),
        })
      }

      // 4 — Ask Gemini to find where the real content begins (skip TOC, front matter)
      setStatus('detecting')
      const samplePages = pages.slice(0, 15).filter(p => p.text.trim())
      let startPage = 1
      try {
        const result = await detectStart(samplePages)
        startPage = Math.max(1, result.startPage ?? 1)
      } catch {
        // fallback: start from page 1
      }

      const endPage = Math.min(startPage + PAGE_LIMIT - 1, numPages)
      const book = { id: 'current', title, cover, totalPages: numPages, startPage, endPage, createdAt: Date.now() }
      await saveBook(book)

      // 5 — Navigate to confirm screen (no processing yet — user must click "Começar")
      onReady(book)
    } catch (err) {
      console.error(err)
      setError('Não foi possível processar este PDF. Tente novamente.')
      setStatus('error')
    }
  }

  return (
    <div className="screen upload">
      <header className="brand">
        <h1>Audiobook Mate AI</h1>
        <p>Transforme qualquer PDF em um audiobook narrado.</p>
      </header>

      <div className="upload-card">
        <div className="upload-icon" aria-hidden>📖</div>

        {status === 'parsing' && (
          <div className="upload-progress">
            <p>Lendo seu livro…</p>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="muted">{Math.round(progress * 100)}%</span>
          </div>
        )}

        {status === 'detecting' && (
          <div className="upload-progress">
            <p>Identificando estrutura do livro…</p>
            <div className="bar">
              <div className="bar-fill bar-fill--pulse" style={{ width: '100%' }} />
            </div>
          </div>
        )}

        {(status === 'idle' || status === 'error') && (
          <>
            <button className="btn-primary" onClick={() => inputRef.current?.click()}>
              Enviar PDF
            </button>
            {status === 'error' && <p className="error">{error}</p>}
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={handleFile}
        />
      </div>

      <p className="footnote muted">
        Seu arquivo fica neste navegador — nada é enviado para um servidor.
      </p>
    </div>
  )
}
