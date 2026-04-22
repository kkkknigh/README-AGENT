import { getParsedDocument, type CachedPdfParagraph } from "./document-cache.js"
import { getDocument, updateDocument } from "./library.js"

type HtmlBlock = {
  block_id: number
  type: string
  paragraph_id: string | null
  page: number | null
  paragraph_index: number | null
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
}

function buildHtml(paragraphs: CachedPdfParagraph[]) {
  const blocks: HtmlBlock[] = []
  const body = paragraphs.map((paragraph, index) => {
    blocks.push({
      block_id: index + 1,
      type: "paragraph",
      paragraph_id: paragraph.id,
      page: paragraph.page,
      paragraph_index: index,
    })
    return `<p data-block-id="${index + 1}" data-page="${paragraph.page}" data-paragraph-id="${paragraph.id}">${escapeHtml(paragraph.content)}</p>`
  }).join("\n")

  return {
    html_content: `<article class="readmeclaw-html">\n${body}\n</article>`,
    mapping: { blocks },
    source: "local-runtime",
    status: "completed",
  }
}

export function getHtmlDocument(pdfId: string) {
  const cached = getParsedDocument(pdfId)
  if (!cached) return null
  return buildHtml(cached.paragraphs)
}

export function generateHtmlDocument(pdfId: string) {
  const html = getHtmlDocument(pdfId)
  if (!html) return null
  const document = getDocument(pdfId)
  if (document) {
    updateDocument(pdfId, {
      htmlStatus: "completed",
      metadata: {
        ...document.metadata,
        htmlGeneratedAt: new Date().toISOString(),
      },
    })
  }
  return {
    ...html,
    task_id: null,
    deduped: false,
    message: "HTML generated locally.",
  }
}
