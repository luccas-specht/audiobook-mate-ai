const GEMINI_API      = 'https://generativelanguage.googleapis.com/v1'
const GEMINI_API_BETA = 'https://generativelanguage.googleapis.com/v1beta'

const VOICE_MALE   = 'Charon'
const VOICE_FEMALE = 'Aoede'

// Fixed narration style prepended to every TTS call.
// Explicit constraints prevent the model from dramatizing tone across page boundaries.
const TTS_STYLE = `Leia o texto a seguir como narrador profissional de audiobook em português. Siga estas regras sem exceção:
- Tom neutro, calmo e uniforme do início ao fim
- Volume constante — não aumente nem diminua independentemente do conteúdo
- Velocidade moderada e estável — não acelere em cenas de ação nem sussurre em diálogos
- Não dramatize falas de personagens — leia tudo na mesma voz de narrador
- Ignore pontuação dramática (reticências, exclamações) para fins de entonação

Texto:`

const ANALYZE_MODELS = [
  { model: 'gemini-3.5-flash-lite', base: GEMINI_API },
  { model: 'gemini-3.1-flash-lite', base: GEMINI_API },
  { model: 'gemini-3.5-flash',      base: GEMINI_API },
]

const TTS_MODELS = [
  { model: 'gemini-3.1-flash-tts-preview',  base: GEMINI_API_BETA },
  { model: 'gemini-2.5-flash-preview-tts',  base: GEMINI_API_BETA },
  { model: 'gemini-2.5-pro-preview-tts',    base: GEMINI_API_BETA },
]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const RETRYABLE = new Set([429, 503])
const MAX_RETRIES = 2

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/analyze') {
      return handleAnalyze(request, env)
    }
    if (request.method === 'POST' && url.pathname === '/tts') {
      return handleTts(request, env)
    }
    if (request.method === 'POST' && url.pathname === '/detect-start') {
      return handleDetectStart(request, env)
    }

    return json({ error: 'Not found' }, 404)
  },
}

// ---------------------------------------------------------------------------
// POST /analyze  →  [{ type, speaker, gender, text }, ...]
// ---------------------------------------------------------------------------
async function handleAnalyze(request, env) {
  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { text } = body
  if (!text || typeof text !== 'string') return json({ error: '`text` is required' }, 400)

  const prompt = buildAnalyzePrompt(text)

  const { data, attempted, lastError } = await fetchWithFallback(
    ANALYZE_MODELS,
    ({ model, base }) => fetch(
      `${base}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    )
  )

  if (!data) {
    return json({ error: 'All Gemini analyze models failed', attempted, detail: lastError }, 502)
  }

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
  let script
  try { script = JSON.parse(raw) } catch {
    return json({ error: 'Gemini returned non-JSON', raw }, 502)
  }

  return json(script)
}

// ---------------------------------------------------------------------------
// POST /detect-start  →  { startPage: number }
// ---------------------------------------------------------------------------
async function handleDetectStart(request, env) {
  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { pages } = body
  if (!Array.isArray(pages) || pages.length === 0) return json({ error: '`pages` is required' }, 400)

  const pagesSample = pages
    .map(p => `[Página ${p.pageNumber}]:\n${String(p.text ?? '').slice(0, 400)}`)
    .join('\n\n')

  const prompt = `You are analyzing the structure of a book extracted from a PDF.
Given the following pages, find where the actual reading content begins.
Skip: table of contents, index, copyright, dedication, epigraphs, author bio, blank pages.
Prefer: prologue if present, otherwise Chapter 1, otherwise the first narrative page.

Return ONLY valid JSON (no markdown): {"startPage": <number>}

Pages:
${pagesSample}`

  const { data, attempted, lastError } = await fetchWithFallback(
    ANALYZE_MODELS,
    ({ model, base }) => fetch(
      `${base}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    )
  )

  if (!data) return json({ error: 'Gemini detect-start failed', attempted, detail: lastError }, 502)

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
  let result
  try { result = JSON.parse(raw) } catch { result = {} }

  return json({ startPage: result.startPage ?? pages[0].pageNumber })
}

// ---------------------------------------------------------------------------
// POST /tts  →  audio binary
// ---------------------------------------------------------------------------
async function handleTts(request, env) {
  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { text, gender } = body
  if (!text || typeof text !== 'string') return json({ error: '`text` is required' }, 400)
  if (gender !== 'male' && gender !== 'female') return json({ error: '`gender` must be male or female' }, 400)

  const voiceName = gender === 'female' ? VOICE_FEMALE : VOICE_MALE

  // Prefix a fixed narration-style instruction so the baseline tone stays
  // consistent across independent per-page TTS calls.
  const styled = `${TTS_STYLE}\n\n${text}`

  const { data, attempted, lastError } = await fetchWithFallback(
    TTS_MODELS,
    ({ model, base }) => fetch(
      `${base}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: styled }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
          },
        }),
      }
    )
  )

  if (!data) {
    return json({ error: 'All Gemini TTS models failed', attempted, detail: lastError }, 502)
  }

  const part = data.candidates?.[0]?.content?.parts?.[0]?.inlineData
  if (!part?.data) return json({ error: 'No audio in Gemini response' }, 502)

  const pcm = base64ToBuffer(part.data)
  const wav = pcmToWav(pcm, 24000, 1, 16)

  return new Response(wav, {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'audio/wav' },
  })
}

// ---------------------------------------------------------------------------
// Shared retry + fallback helper
// Returns { data, attempted, lastError }
// ---------------------------------------------------------------------------
async function fetchWithFallback(models, buildRequest) {
  const attempted = []
  let lastError = null

  for (const entry of models) {
    attempted.push(entry.model)
    let delay = 1000

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(delay) && (delay *= 2)

      let res
      try { res = await buildRequest(entry) } catch (err) {
        lastError = String(err)
        break
      }

      if (res.ok) {
        const data = await res.json()
        return { data, attempted, lastError: null }
      }

      lastError = await res.text()

      if (!RETRYABLE.has(res.status)) break // hard error — skip to next model immediately
    }
  }

  return { data: null, attempted, lastError }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildAnalyzePrompt(text) {
  return `Determine the gender of the primary narrator or point-of-view character on this book page.
If a male character narrates or is the main POV, return "male". If female, return "female". Default to "male" if unclear.

Return ONLY valid JSON (no markdown): {"narratorGender": "male"} or {"narratorGender": "female"}

Text:
${text}`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function base64ToBuffer(b64) {
  const binary = atob(b64)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf.buffer
}

// Wrap raw PCM bytes in a WAV container so browsers (and afplay) can play it.
function pcmToWav(pcmBuffer, sampleRate, channels, bitsPerSample) {
  const pcm = new Uint8Array(pcmBuffer)
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const buf = new ArrayBuffer(44 + pcm.byteLength)
  const view = new DataView(buf)
  const write = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }
  write(0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)          // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  write(36, 'data')
  view.setUint32(40, pcm.byteLength, true)
  new Uint8Array(buf).set(pcm, 44)
  return buf
}
