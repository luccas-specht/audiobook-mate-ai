import { loadPage, updatePlayback } from './db.js'
import { processor } from './pageProcessor.js'

const SAVE_INTERVAL_MS = 5_000
const PREFETCH_AHEAD   = 2

export class AudioPlayer {
  /**
   * @param {string}  bookId
   * @param {number}  startPage     page number to begin from (1-based)
   * @param {number}  startPosition seconds offset within that page
   * @param {number}  endPage       last page to play (inclusive); use book.endPage
   * @param {{
   *   onPage:      (n:number)=>void,
   *   onProgress:  (sec:number, total:number)=>void,
   *   onBuffering: (b:boolean)=>void,
   *   onEnd:       ()=>void,
   * }} callbacks
   */
  constructor(bookId, startPage, startPosition, endPage, callbacks = {}) {
    this._bookId       = bookId
    this._currentPage  = startPage
    this._startPos     = startPosition
    this._endPage      = endPage
    this._cb           = callbacks

    this._audio        = new Audio()
    this._blobUrl      = null
    this._mountedPage  = null
    this._playing      = false
    this._destroyed    = false

    this._saveTimer    = null
    this._unsubscribe  = null

    this._visChange    = () => { if (document.hidden) this._saveNow() }
    document.addEventListener('visibilitychange', this._visChange)

    this._audio.addEventListener('pause',  () => this._saveNow())
    this._audio.addEventListener('ended',  () => this._onEnded())
    this._audio.addEventListener('timeupdate', () => this._onTick())

    this._prefetch(startPage)
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async play() {
    if (this._destroyed) return
    this._playing = true

    // Resuming from pause on the already-mounted page — just continue, don't reload.
    if (this._mountedPage === this._currentPage && this._audio.src && !this._audio.ended) {
      this._cb.onBuffering?.(false)
      await this._audio.play().catch(() => {})
      this._startSaveTimer()
      return
    }

    await this._loadPage(this._currentPage, this._startPos)
  }

  pause() {
    this._playing = false
    this._audio.pause()
    this._stopSaveTimer()
  }

  seek(deltaSec) {
    this._audio.currentTime = Math.max(0, this._audio.currentTime + deltaSec)
  }

  destroy() {
    this._destroyed = true
    this._playing   = false
    this._audio.pause()
    this._revokeBlobUrl()
    this._stopSaveTimer()
    this._unsubscribe?.()
    document.removeEventListener('visibilitychange', this._visChange)
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  async _loadPage(pageNumber, resumeAt = 0) {
    if (this._destroyed) return
    this._currentPage = pageNumber   // sync before any await so saves always target the right page
    this._cb.onBuffering?.(true)
    this._unsubscribe?.()
    this._unsubscribe = null

    const page = await loadPage(this._bookId, pageNumber)

    if (!page || page.status !== 'ready') {
      // Ensure it's queued then wait for it.
      processor.enqueue(this._bookId, pageNumber)
      this._unsubscribe = processor.onPageReady((bId, pNum) => {
        if (bId === this._bookId && pNum === pageNumber) {
          this._unsubscribe?.()
          this._unsubscribe = null
          this._loadPage(pageNumber, resumeAt)
        }
      })
      return
    }

    // Blank page (no audio) — skip it silently.
    if (!page.audio) {
      await this._onEnded()
      return
    }

    this._mountAudio(page, resumeAt)
  }

  _mountAudio(page, resumeAt) {
    if (this._destroyed) return
    this._revokeBlobUrl()

    const blob = new Blob([page.audio], { type: 'audio/wav' })
    this._blobUrl = URL.createObjectURL(blob)
    this._audio.src = this._blobUrl
    this._mountedPage = page.pageNumber

    this._audio.addEventListener('loadedmetadata', () => {
      if (resumeAt > 0) this._audio.currentTime = Math.min(resumeAt, this._audio.duration - 0.1)
      this._cb.onBuffering?.(false)
      this._cb.onPage?.(page.pageNumber)
      this._cb.onProgress?.(this._audio.currentTime, this._audio.duration)
      this._startPos = 0

      if (this._playing) {
        this._audio.play().catch(() => {})
        this._startSaveTimer()
      }
    }, { once: true })

    this._prefetch(page.pageNumber)
  }

  _onTick() {
    this._cb.onProgress?.(this._audio.currentTime, this._audio.duration || 0)
  }

  async _onEnded() {
    this._saveNow()
    await updatePlayback(this._bookId, this._currentPage, this._audio.duration ?? 0, true)

    const next = this._currentPage + 1
    if (next > this._endPage) {
      this._playing = false
      this._cb.onEnd?.()
      return
    }

    this._currentPage = next
    if (this._playing) await this._loadPage(next, 0)
  }

  _prefetch(fromPage) {
    for (let i = 1; i <= PREFETCH_AHEAD; i++) {
      const p = fromPage + i
      if (p <= this._endPage) processor.enqueue(this._bookId, p)
    }
  }

  _startSaveTimer() {
    this._stopSaveTimer()
    this._saveTimer = setInterval(() => this._saveNow(), SAVE_INTERVAL_MS)
  }

  _stopSaveTimer() {
    if (this._saveTimer) { clearInterval(this._saveTimer); this._saveTimer = null }
  }

  _saveNow() {
    const t = this._audio.currentTime
    if (t > 0) updatePlayback(this._bookId, this._currentPage, t, false)
  }

  _revokeBlobUrl() {
    if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null }
  }
}
