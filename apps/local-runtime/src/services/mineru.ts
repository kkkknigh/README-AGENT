import { createHash } from "node:crypto"
import JSZip from "jszip"
import type { CachedPdfLayout } from "./document-cache.js"
import { getMineruConfig } from "../config.js"

export interface ParsedMineruDocument {
  pdfId: string
  filename: string
  markdown: string
  layout: CachedPdfLayout
}

function getMineruHeaders() {
  const mineru = getMineruConfig()
  return {
    mineru,
    headers: {
      ...(mineru.apiKey ? { Authorization: `Bearer ${mineru.apiKey}` } : {}),
    },
  }
}

function buildBaseUrl(input: string) {
  return input.replace(/\/$/, "")
}

function stablePdfId(seed: string) {
  return createHash("sha1").update(seed).digest("hex").slice(0, 24)
}

function emptyLayout(): CachedPdfLayout {
  return {
    images: [],
    tables: [],
    formulas: [],
  }
}

async function readMarkdownFromUrl(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`Failed to download MinerU markdown: ${response.status}`)
  }
  return response.text()
}

function extractMarkdownUrl(data: Record<string, any>) {
  return data?.markdown_url
    || data?.md_url
    || data?.result?.markdown_url
    || data?.result?.md_url
    || null
}

function normalizePage(value: unknown) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 1
  return num >= 1 ? num : num + 1
}

function inferDimensions(node: Record<string, any>) {
  const candidates = [
    [node.page_width, node.page_height],
    [node.width, node.height],
    [node.page_w, node.page_h],
    [node.w, node.h],
  ]
  for (const [width, height] of candidates) {
    const w = Number(width)
    const h = Number(height)
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: w, height: h }
    }
  }
  return null
}

function extractBBox(node: Record<string, any>) {
  const bbox = node.bbox || node.box || node.boundary || node.rect
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const [x0, y0, x1, y1] = bbox.map(Number)
    if ([x0, y0, x1, y1].every(Number.isFinite)) {
      return { x0, y0, x1, y1 }
    }
  }

  const poly = node.poly || node.polygon
  if (Array.isArray(poly) && poly.length >= 8) {
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i + 1 < poly.length; i += 2) {
      const x = Number(poly[i])
      const y = Number(poly[i + 1])
      if (Number.isFinite(x) && Number.isFinite(y)) {
        xs.push(x)
        ys.push(y)
      }
    }
    if (xs.length && ys.length) {
      return {
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      }
    }
  }

  return null
}

function classifyNode(node: Record<string, any>) {
  const text = [
    node.type,
    node.category_type,
    node.block_type,
    node.sub_type,
    node.tag,
  ]
    .filter(Boolean)
    .map((item) => String(item).toLowerCase())
    .join(" ")

  if (text.includes("table")) return "table" as const
  if (text.includes("formula") || text.includes("equation")) return "formula" as const
  if (text.includes("image") || text.includes("figure") || text.includes("picture")) return "image" as const
  return null
}

function normalizeBBox(
  bbox: { x0: number; y0: number; x1: number; y1: number },
  dims: { width: number; height: number } | null,
) {
  const width = Math.max(1, dims?.width ?? bbox.x1)
  const height = Math.max(1, dims?.height ?? bbox.y1)
  return {
    left: Math.max(0, Math.min(1, bbox.x0 / width)),
    top: Math.max(0, Math.min(1, bbox.y0 / height)),
    width: Math.max(0, Math.min(1, (bbox.x1 - bbox.x0) / width)),
    height: Math.max(0, Math.min(1, (bbox.y1 - bbox.y0) / height)),
  }
}

function collectLayoutFromMiddleJson(input: unknown): CachedPdfLayout {
  const layout = emptyLayout()
  const seen = new Set<string>()

  const walk = (
    node: unknown,
    context: { page: number; dims: { width: number; height: number } | null },
  ) => {
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, context))
      return
    }
    if (!node || typeof node !== "object") return

    const record = node as Record<string, any>
    const nextContext = {
      page: record.page_idx != null || record.page_no != null || record.page != null
        ? normalizePage(record.page_idx ?? record.page_no ?? record.page)
        : context.page,
      dims: inferDimensions(record) ?? context.dims,
    }

    const kind = classifyNode(record)
    const bbox = extractBBox(record)
    if (kind && bbox) {
      const normalized = normalizeBBox(bbox, nextContext.dims)
      const key = `${kind}:${nextContext.page}:${normalized.left}:${normalized.top}:${normalized.width}:${normalized.height}`
      if (!seen.has(key)) {
        seen.add(key)
        if (kind === "formula") {
          layout.formulas.push({
            page: nextContext.page,
            index: layout.formulas.filter((item) => item.page === nextContext.page).length,
            bboxNorm: normalized,
            latex: record.latex || record.text || record.content || null,
          })
        } else if (kind === "table") {
          layout.tables.push({
            page: nextContext.page,
            index: layout.tables.filter((item) => item.page === nextContext.page).length,
            bboxNorm: normalized,
          })
        } else {
          layout.images.push({
            page: nextContext.page,
            index: layout.images.filter((item) => item.page === nextContext.page).length,
            bboxNorm: normalized,
          })
        }
      }
    }

    Object.values(record).forEach((value) => {
      if (value && typeof value === "object") {
        walk(value, nextContext)
      }
    })
  }

  walk(input, { page: 1, dims: null })
  return layout
}

async function parseResultZip(zipUrl: string, headers: Record<string, string>) {
  const response = await fetch(zipUrl, { headers })
  if (!response.ok) {
    throw new Error(`Failed to download MinerU result zip: ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)
  const mdEntry = Object.values(zip.files).find((entry) => /full\.md$/i.test(entry.name))
  const middleEntry = Object.values(zip.files).find((entry) => /middle\.json$/i.test(entry.name))

  if (!mdEntry) {
    throw new Error("MinerU result zip does not contain full.md")
  }

  const markdown = await mdEntry.async("text")
  const middleJson = middleEntry ? JSON.parse(await middleEntry.async("text")) : null

  return {
    markdown,
    layout: middleJson ? collectLayoutFromMiddleJson(middleJson) : emptyLayout(),
  }
}

function collectZipUrl(input: unknown): string | null {
  if (typeof input === "string") {
    return /\.zip(\?|$)/i.test(input) ? input : null
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = collectZipUrl(item)
      if (found) return found
    }
    return null
  }
  if (!input || typeof input !== "object") return null
  for (const value of Object.values(input as Record<string, unknown>)) {
    const found = collectZipUrl(value)
    if (found) return found
  }
  return null
}

function extractBatchId(payload: Record<string, any>) {
  return payload.batch_id
    || payload.id
    || payload.data?.batch_id
    || payload.data?.id
    || null
}

async function pollPreciseResult(batchId: string, baseUrl: string, headers: Record<string, string>) {
  const url = `${baseUrl}/api/v4/extract-results/batch/${batchId}`
  let lastPayload: Record<string, any> | null = null

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(url, { headers })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`MinerU batch poll failed: ${response.status} ${detail}`.trim())
    }

    const payload = await response.json() as Record<string, any>
    lastPayload = payload
    const zipUrl = collectZipUrl(payload)
    if (zipUrl) return zipUrl

    const payloadText = JSON.stringify(payload).toLowerCase()
    if (payloadText.includes("\"failed\"") || payloadText.includes("\"error\"")) {
      throw new Error("MinerU precise extraction failed")
    }

    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  throw new Error(`MinerU precise extraction timed out: ${JSON.stringify(lastPayload)}`)
}

async function submitPreciseTask(files: Array<Record<string, any>>, baseUrl: string, headers: Record<string, string>) {
  const response = await fetch(`${baseUrl}/api/v4/extract/task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      enable_formula: true,
      enable_table: true,
      files,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`MinerU precise task submit failed: ${response.status} ${detail}`.trim())
  }

  const payload = await response.json() as Record<string, any>
  const batchId = extractBatchId(payload)
  if (!batchId) {
    throw new Error("MinerU precise task response does not contain batch_id")
  }
  return String(batchId)
}

async function tryPreciseUrlParse(input: { url: string }) {
  const { mineru, headers } = getMineruHeaders()
  const baseUrl = buildBaseUrl(mineru.baseUrl)
  const batchId = await submitPreciseTask([
    {
      url: input.url,
      data_id: stablePdfId(input.url),
      is_ocr: true,
    },
  ], baseUrl, headers)
  const zipUrl = await pollPreciseResult(batchId, baseUrl, headers)
  return parseResultZip(zipUrl, headers)
}

async function requestUploadUrls(input: { filename: string }, baseUrl: string, headers: Record<string, string>) {
  const response = await fetch(`${baseUrl}/api/v4/file-urls/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      files: [
        {
          name: input.filename,
          data_id: stablePdfId(input.filename),
          is_ocr: true,
        },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`MinerU file url request failed: ${response.status} ${detail}`.trim())
  }

  const payload = await response.json() as Record<string, any>
  const values = JSON.stringify(payload)
  const uploadUrlMatch = values.match(/https?:\/\/[^"]+/g)?.find((item) => /upload|signed|presign/i.test(item))
  const fileUrlMatch = values.match(/https?:\/\/[^"]+/g)?.find((item) => !/upload|signed|presign/i.test(item))

  if (!uploadUrlMatch || !fileUrlMatch) {
    throw new Error("MinerU file url response missing upload or file url")
  }

  return {
    uploadUrl: uploadUrlMatch,
    fileUrl: fileUrlMatch,
  }
}

async function tryPreciseFileParse(input: { filename: string; bytes: Uint8Array }) {
  const { mineru, headers } = getMineruHeaders()
  const baseUrl = buildBaseUrl(mineru.baseUrl)
  const { uploadUrl, fileUrl } = await requestUploadUrls({ filename: input.filename }, baseUrl, headers)
  const fileView = new Uint8Array(input.bytes.byteLength)
  fileView.set(input.bytes)

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
    },
    body: fileView,
  })

  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text()
    throw new Error(`MinerU upload failed: ${uploadResponse.status} ${detail}`.trim())
  }

  const batchId = await submitPreciseTask([
    {
      url: fileUrl,
      data_id: stablePdfId(`${input.filename}:${input.bytes.byteLength}`),
      is_ocr: true,
    },
  ], baseUrl, headers)
  const zipUrl = await pollPreciseResult(batchId, baseUrl, headers)
  return parseResultZip(zipUrl, headers)
}

async function fallbackAgentFileParse(input: { filename: string; bytes: Uint8Array }) {
  const { mineru, headers } = getMineruHeaders()
  const form = new FormData()
  const fileView = new Uint8Array(input.bytes.byteLength)
  fileView.set(input.bytes)
  form.append("file", new Blob([fileView as unknown as BlobPart], { type: "application/pdf" }), input.filename)

  const response = await fetch(`${buildBaseUrl(mineru.baseUrl)}/api/v1/agent/parse/file`, {
    method: "POST",
    headers,
    body: form,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`MinerU file parse failed: ${response.status} ${detail}`.trim())
  }

  const payload = await response.json() as Record<string, any>
  const markdownUrl = extractMarkdownUrl(payload)
  if (!markdownUrl) {
    throw new Error("MinerU file parse response does not contain markdown_url")
  }

  const markdown = await readMarkdownFromUrl(String(markdownUrl), headers)
  return {
    markdown,
    layout: emptyLayout(),
  }
}

async function fallbackAgentUrlParse(input: { url: string }) {
  const { mineru, headers } = getMineruHeaders()
  const response = await fetch(`${buildBaseUrl(mineru.baseUrl)}/api/v1/agent/parse/url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      url: input.url,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`MinerU url parse failed: ${response.status} ${detail}`.trim())
  }

  const payload = await response.json() as Record<string, any>
  const markdownUrl = extractMarkdownUrl(payload)
  if (!markdownUrl) {
    throw new Error("MinerU url parse response does not contain markdown_url")
  }

  const markdown = await readMarkdownFromUrl(String(markdownUrl), headers)
  return {
    markdown,
    layout: emptyLayout(),
  }
}

export async function parsePdfFileWithMineru(input: {
  filename: string
  bytes: Uint8Array
}): Promise<ParsedMineruDocument> {
  const { mineru } = getMineruHeaders()
  if (!mineru.baseUrl) {
    throw new Error("MinerU baseUrl is missing in config.yaml")
  }

  const parsed = await tryPreciseFileParse(input).catch(() => fallbackAgentFileParse(input))
  return {
    pdfId: stablePdfId(`${input.filename}:${input.bytes.byteLength}:${parsed.markdown.slice(0, 1024)}`),
    filename: input.filename,
    markdown: parsed.markdown,
    layout: parsed.layout,
  }
}

export async function parseUrlWithMineru(input: {
  url: string
}): Promise<ParsedMineruDocument> {
  const { mineru } = getMineruHeaders()
  if (!mineru.baseUrl) {
    throw new Error("MinerU baseUrl is missing in config.yaml")
  }

  const parsed = await tryPreciseUrlParse(input).catch(() => fallbackAgentUrlParse(input))
  return {
    pdfId: stablePdfId(`${input.url}:${parsed.markdown.slice(0, 1024)}`),
    filename: input.url.replace(/^https?:\/\//, "").slice(0, 120) || "Imported Link",
    markdown: parsed.markdown,
    layout: parsed.layout,
  }
}
