import { analyzeText, generateAudio } from './worker.js'
import { loadPage, updatePage } from './db.js'

const MAX_CONCURRENT = 1

/** Duration in seconds of a WAV ArrayBuffer (24 kHz, 16-bit, mono). */
function wavDuration(buf) {
  return (buf.byteLength - 44) / (24000 * 2)
}

// ---------------------------------------------------------------------------
// PageProcessor — FIFO queue, bounded concurrency, status events
// ---------------------------------------------------------------------------

class PageProcessor {
  constructor() {
    this._queue           = []
    this._active          = new Set()
    this._listeners       = new Set()
    this._statusListeners = new Set()
    this._currentStatus   = ''
  }

  get status() { return this._currentStatus }

  onStatus(cb) {
    this._statusListeners.add(cb)
    return () => this._statusListeners.delete(cb)
  }

  _setStatus(msg) {
    this._currentStatus = msg
    for (const cb of this._statusListeners) cb(msg)
  }

  enqueue(bookId, pageNumber) {
    const key = `${bookId}:${pageNumber}`
    if (this._active.has(key)) return
    if (this._queue.some(i => `${i.bookId}:${i.pageNumber}` === key)) return
    this._queue.push({ bookId, pageNumber })
    this._drain()
  }

  onPageReady(cb) {
    this._listeners.add(cb)
    return () => this._listeners.delete(cb)
  }

  cancelBook(bookId) {
    this._queue = this._queue.filter(i => i.bookId !== bookId)
  }

  _drain() {
    while (this._active.size < MAX_CONCURRENT && this._queue.length > 0) {
      const item = this._queue.shift()
      const key  = `${item.bookId}:${item.pageNumber}`
      this._active.add(key)
      this._processPage(item)
        .catch(err => console.error(`[processor] page ${item.pageNumber} failed:`, err))
        .finally(() => { this._active.delete(key); this._drain() })
    }
  }

  async _processPage({ bookId, pageNumber }) {
    const page = await loadPage(bookId, pageNumber)
    if (!page) return
    if (page.status === 'ready') return
    // 'failed' pages fall through and are retried

    // Blank / image-only pages — skip worker, mark ready with no audio.
    if (!page.text?.trim()) {
      await updatePage(bookId, pageNumber, { status: 'ready', script: null, audio: null, duration: 0 })
      for (const cb of this._listeners) cb(bookId, pageNumber)
      return
    }

    try {
      // 1 — Detect narrator gender for the whole page (one analyze call)
      this._setStatus(`Página ${pageNumber} — analisando…`)
      await updatePage(bookId, pageNumber, { status: 'analyzing' })
      const { narratorGender } = await analyzeText(page.text)
      const gender = narratorGender ?? 'male'

      // 2 — Generate audio for the entire page with one TTS call
      this._setStatus(`Página ${pageNumber} — gerando áudio…`)
      const audio    = await generateAudio(page.text, gender)
      const duration = wavDuration(audio)

      await updatePage(bookId, pageNumber, {
        status: 'ready',
        script: { narratorGender: gender },
        audio,
        duration,
      })

      this._setStatus('')
      for (const cb of this._listeners) cb(bookId, pageNumber)
    } catch (err) {
      this._setStatus('')
      await updatePage(bookId, pageNumber, { status: 'failed' })
      throw err
    }
  }
}

export const processor = new PageProcessor()
