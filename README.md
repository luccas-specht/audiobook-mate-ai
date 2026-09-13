# Audiobook Mate AI

A personal AI audiobook app. Upload a PDF, the AI understands the text, identifies speakers and their gender, and reads it aloud using a male or female voice accordingly.

## Current state — MVP-0 (live)

- **Upload screen** — pick a PDF; pdf.js extracts text + cover image in-browser
- **Player screen** — Audible-style: cover, title, play/pause, −15s, +30s, progress bar, auto-resume
- Storage: IndexedDB (no server, GitHub Pages is static)
- TTS: browser Web Speech API with a dumb heuristic (quoted text → female, rest → male)

Live at: https://pages.github.concur.com/I770682/audiobook-mate-ai/

## Target architecture

```
PDF
 ↓
pdf.js (in browser)
 ↓
Extracted text
 ↓
Cloudflare Worker → Gemini (understand text, identify speakers + gender)
 ↓
Structured JSON script
 ↓
Cloudflare Worker → Gemini TTS (male voice / female voice per segment)
 ↓
Audio chunks → IndexedDB
 ↓
Audiobook Player
```

## JSON script schema

```json
[
  { "type": "narration", "speaker": "narrator", "gender": "male",   "text": "John entered the room." },
  { "type": "dialogue",  "speaker": "Sarah",    "gender": "female", "text": "Are you okay?"          },
  { "type": "dialogue",  "speaker": "John",     "gender": "male",   "text": "I'm fine."              }
]
```

The `gender` field drives voice selection — one fixed male voice for all male segments, one fixed female voice for all female segments.

## Cloudflare Worker API

| Endpoint | Input | Output |
|---|---|---|
| `POST /analyze` | `{ text }` | JSON script array |
| `POST /tts` | `{ text, gender }` | mp3 audio chunk |

## Stack

- React + Vite — frontend
- IndexedDB (idb) — local storage for book data, JSON script, audio chunks, resume position
- pdf.js — PDF text + cover extraction
- Cloudflare Workers — serverless backend (holds Gemini API key)
- Google Gemini — text understanding
- Google Gemini TTS — voice generation (two voices: one male, one female)

## Roadmap

- [x] MVP-0 — upload screen, Audible-style player, browser TTS
- [ ] MVP-1 — Cloudflare Worker + Gemini text understanding → JSON script
- [ ] MVP-2 — Gemini TTS integration → real audio playback from IndexedDB
