// MVP-0 text-to-speech using the browser's built-in Web Speech API.
// It's free, offline, needs no API key, and CAN use different system voices,
// so we can already demo male/female switching. The voice quality is robotic
// compared to ElevenLabs — swapping this module for a real TTS backend is the
// MVP-2 step. Real per-character / gender detection is MVP-1 (Claude); for now
// we use a cheap heuristic: quoted text = "dialogue", everything else = narrator.

const WORDS_PER_SEC = 2.7 // rough spoken pace at rate 1.0, used for timing math

/** Split a blob of text into sentence-ish chunks for sequential speaking. */
export function splitSentences(text) {
  return text
    .split(/(?<=[.!?"'”’])\s+(?=[A-Z"'“‘])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const isDialogue = (s) => /["“”']/.test(s)
const estDuration = (s) => Math.max(1.2, s.split(/\s+/).length / WORDS_PER_SEC)

export class Reader {
  /**
   * @param {string[]} sentences
   * @param {{onIndex?:(i:number)=>void, onProgress?:(sec:number,total:number)=>void, onEnd?:()=>void}} cb
   */
  constructor(sentences, cb = {}) {
    this.sentences = sentences
    this.cb = cb
    this.index = 0
    this.playing = false

    // Cumulative start-time (seconds) of each sentence, for the progress bar + seeking.
    this.starts = []
    let acc = 0
    for (const s of sentences) {
      this.starts.push(acc)
      acc += estDuration(s)
    }
    this.total = acc

    // Pick two distinct system voices so narration vs dialogue sound different.
    this.narratorVoice = null
    this.dialogueVoice = null
    this._pickVoices()
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.onvoiceschanged = () => this._pickVoices()
    }

    this._tickTimer = null
  }

  _pickVoices() {
    if (typeof speechSynthesis === 'undefined') return
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
    if (!voices.length) return
    const female = voices.find((v) => /female|samantha|victoria|zira|karen|moira/i.test(v.name))
    const male = voices.find((v) => /male|daniel|alex|david|fred|george/i.test(v.name))
    this.narratorVoice = male || voices[0]
    this.dialogueVoice = female || voices[1] || voices[0]
  }

  get elapsed() {
    return this.starts[this.index] ?? this.total
  }

  play() {
    if (this.playing) return
    this.playing = true
    this._speakCurrent()
    this._startTick()
  }

  pause() {
    this.playing = false
    speechSynthesis.cancel()
    this._stopTick()
  }

  toggle() {
    this.playing ? this.pause() : this.play()
  }

  /** Jump forward/back by a number of seconds (approx, at sentence granularity). */
  seek(deltaSec) {
    const target = Math.min(Math.max(this.elapsed + deltaSec, 0), this.total)
    let i = this.starts.findIndex((start, k) => {
      const next = this.starts[k + 1] ?? this.total
      return target >= start && target < next
    })
    if (i < 0) i = this.sentences.length - 1
    this.index = i
    this.cb.onIndex?.(this.index)
    this.cb.onProgress?.(this.elapsed, this.total)
    if (this.playing) {
      speechSynthesis.cancel()
      this._speakCurrent()
    }
  }

  seekToIndex(i) {
    this.index = Math.min(Math.max(i, 0), this.sentences.length - 1)
    this.cb.onIndex?.(this.index)
    this.cb.onProgress?.(this.elapsed, this.total)
  }

  destroy() {
    this.pause()
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = null
  }

  _speakCurrent() {
    const sentence = this.sentences[this.index]
    if (sentence == null) {
      this.playing = false
      this._stopTick()
      this.cb.onEnd?.()
      return
    }
    this.cb.onIndex?.(this.index)

    const u = new SpeechSynthesisUtterance(sentence)
    u.voice = isDialogue(sentence) ? this.dialogueVoice : this.narratorVoice
    u.rate = 1
    u.onend = () => {
      if (!this.playing) return
      this.index += 1
      this._speakCurrent()
    }
    speechSynthesis.speak(u)
  }

  _startTick() {
    this._stopTick()
    this._tickTimer = setInterval(() => {
      this.cb.onProgress?.(this.elapsed, this.total)
    }, 500)
  }

  _stopTick() {
    if (this._tickTimer) clearInterval(this._tickTimer)
    this._tickTimer = null
  }
}
