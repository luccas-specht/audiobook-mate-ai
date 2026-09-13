import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker

/**
 * Extract text page-by-page and a cover image from a PDF file.
 *
 * @param {File|Blob} file - the uploaded PDF
 * @param {(ratio:number)=>void} [onProgress] - 0..1 text-extraction progress
 * @returns {Promise<{
 *   pages: Array<{ pageNumber: number, text: string }>,
 *   cover: string,
 *   title: string,
 *   numPages: number
 * }>}
 */
export async function parsePdf(file, onProgress) {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise

  // --- Title: prefer PDF metadata, fall back to the file name ---
  let title = ''

  try {
    const meta = await pdf.getMetadata()
    title = meta?.info?.Title?.trim() || ''
  } catch {
    /* metadata is optional */
  }

  if (!title) {
    title = (file.name || 'Untitled')
      .replace(/\.pdf$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim()
  }

  // --- Text: keep each PDF page separate ---
  const pages = []

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()

    const pageText = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')

    pages.push({
      pageNumber: n,
      text: normalize(pageText),
    })

    onProgress?.(n / pdf.numPages)
  }

  // --- Cover: render page 1 to a canvas and export as PNG ---
  const cover = await renderCover(pdf)

  return {
    pages,
    cover,
    title,
    numPages: pdf.numPages,
  }
}

async function renderCover(pdf) {
  const page = await pdf.getPage(1)

  const targetWidth = 600
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({
    scale: targetWidth / base.width,
  })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height

  const ctx = canvas.getContext('2d')

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise

  return canvas.toDataURL('image/png')
}

// Collapse the ragged whitespace that PDF text extraction produces.
function normalize(raw) {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}