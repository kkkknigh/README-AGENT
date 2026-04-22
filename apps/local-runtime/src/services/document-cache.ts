import { db } from "../db/index.js"
import { nowIso } from "./time.js"

export interface CachedPdfParagraph {
  id: string
  page: number
  bbox: {
    x0: number
    y0: number
    x1: number
    y1: number
    width: number
    height: number
  }
  content: string
  wordCount: number
}

export interface CachedPdfLayout {
  images: Array<{
    page: number
    index?: number
    bboxNorm: { left: number; top: number; width: number; height: number }
  }>
  tables: Array<{
    page: number
    index?: number
    bboxNorm: { left: number; top: number; width: number; height: number }
  }>
  formulas: Array<{
    page: number
    index?: number
    bboxNorm: { left: number; top: number; width: number; height: number }
    latex?: string | null
  }>
}

export interface CachedPdfDocument {
  pdfId: string
  filename: string
  pageCount: number
  markdown: string
  paragraphs: CachedPdfParagraph[]
  layout: CachedPdfLayout
  updatedAt: string
}

const CACHE_KEY_PREFIX = "parsed_pdf:"

function cacheKey(pdfId: string) {
  return `${CACHE_KEY_PREFIX}${pdfId}`
}

export function buildParagraphsFromMarkdown(pdfId: string, markdown: string): CachedPdfParagraph[] {
  const chunks = markdown
    .split(/\n\s*\n/g)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)

  return chunks.map((content, index) => {
    const top = 80 + (index % 12) * 52
    const page = Math.floor(index / 12) + 1
    return {
      id: `pdf_chk_${pdfId.slice(0, 8)}_${page}_${index + 1}`,
      page,
      bbox: {
        x0: 60,
        y0: top,
        x1: 540,
        y1: top + 40,
        width: 480,
        height: 40,
      },
      content,
      wordCount: content.split(/\s+/).filter(Boolean).length,
    }
  })
}

export function inferPageCount(paragraphs: CachedPdfParagraph[]) {
  return Math.max(...paragraphs.map((item) => item.page), 1)
}

export function saveParsedDocument(input: Omit<CachedPdfDocument, "updatedAt">) {
  const record: CachedPdfDocument = {
    ...input,
    updatedAt: nowIso(),
  }

  db.prepare(`
    INSERT INTO local_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(cacheKey(input.pdfId), JSON.stringify(record), record.updatedAt)

  return record
}

export function getParsedDocument(pdfId: string): CachedPdfDocument | null {
  const row = db.prepare(`
    SELECT value_json
    FROM local_settings
    WHERE key = ?
  `).get(cacheKey(pdfId)) as { value_json: string } | undefined

  if (!row) return null

  return JSON.parse(row.value_json) as CachedPdfDocument
}
