// Points to localhost in dev, production worker otherwise.
// Override locally via .env.local: VITE_WORKER_URL=http://localhost:8787
const WORKER_URL =
  import.meta.env.VITE_WORKER_URL ??
  'https://audiobook-mate-worker.mvp-audiobook.workers.dev'

export async function detectStart(pages) {
  const res = await fetch(`${WORKER_URL}/detect-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()  // { startPage: number }
}

export async function analyzeText(text) {
  const res = await fetch(`${WORKER_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function generateAudio(text, gender) {
  const res = await fetch(`${WORKER_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, gender }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.arrayBuffer()
}
