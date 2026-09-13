import { openDB } from 'idb'

const DB_NAME = 'audiobook-mate'
const DB_VERSION = 3

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    // v3 is a full schema redesign — drop all prior stores cleanly.
    for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name)

    db.createObjectStore('books', { keyPath: 'id' })

    const pages = db.createObjectStore('pages', { keyPath: ['bookId', 'pageNumber'] })
    pages.createIndex('byBook', 'bookId')
  },
})

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Book
 * @property {string} id
 * @property {string} title
 * @property {string} cover       data-URL PNG
 * @property {number} totalPages
 * @property {number} createdAt
 */

export async function saveBook(book) {
  const db = await dbPromise
  await db.put('books', book)
}

export async function loadBook(id = 'current') {
  const db = await dbPromise
  return db.get('books', id)
}

export async function clearBook(id = 'current') {
  const db = await dbPromise
  const tx = db.transaction(['books', 'pages'], 'readwrite')
  await tx.objectStore('books').delete(id)
  // Delete all pages for this book.
  const index = tx.objectStore('pages').index('byBook')
  let cursor = await index.openCursor(IDBKeyRange.only(id))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Page
 * @property {string}  bookId
 * @property {number}  pageNumber
 * @property {string}  text
 * @property {string}  type          'chapter' | 'cover' | 'prologue' | 'summary' | 'other'
 * @property {string}  status        'pending' | 'analyzing' | 'ready' | 'failed'
 * @property {Array|null}       script
 * @property {ArrayBuffer|null} audio
 * @property {number|null}      duration   seconds
 * @property {{ position: number, completed: boolean }} playback
 * @property {number}  updatedAt
 */

export async function savePage(page) {
  const db = await dbPromise
  await db.put('pages', page)
}

export async function loadPage(bookId, pageNumber) {
  const db = await dbPromise
  return db.get('pages', [bookId, pageNumber])
}

/** Load all pages for a book, sorted by pageNumber. */
export async function loadAllPages(bookId) {
  const db = await dbPromise
  const pages = await db.getAllFromIndex('pages', 'byBook', IDBKeyRange.only(bookId))
  return pages.sort((a, b) => a.pageNumber - b.pageNumber)
}

/** Partial update — merges patch into existing page. */
export async function updatePage(bookId, pageNumber, patch) {
  const db = await dbPromise
  const tx = db.transaction('pages', 'readwrite')
  const page = await tx.store.get([bookId, pageNumber])
  if (!page) { await tx.done; return }
  await tx.store.put({ ...page, ...patch, updatedAt: Date.now() })
  await tx.done
}

/** Throttle-safe playback position save. */
export async function updatePlayback(bookId, pageNumber, position, completed) {
  return updatePage(bookId, pageNumber, { playback: { position, completed } })
}

/**
 * Find the page to resume: first non-completed page within [startPage, endPage].
 * Falls back to startPage if all completed or nothing found.
 */
export async function loadResumePosition(bookId, startPage = 1, endPage = Infinity) {
  const pages = await loadAllPages(bookId)
  const inRange = pages.filter(p => p.pageNumber >= startPage && p.pageNumber <= endPage)
  const resume  = inRange.find(p => !p.playback?.completed)
  if (resume) return { pageNumber: resume.pageNumber, position: resume.playback?.position ?? 0 }
  return { pageNumber: startPage, position: 0 }
}
