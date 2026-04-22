import { getParsedDocument } from "../services/document-cache.js"
import { getDocument } from "../services/library.js"

export function buildDocumentContext(documentId: string) {
  const document = getDocument(documentId)
  const parsed = getParsedDocument(documentId)
  const paragraphPreview = parsed?.paragraphs.slice(0, 4).map((item) => ({
    id: item.id,
    page: item.page,
    text: item.content.slice(0, 240),
  })) ?? []

  return {
    scope: "document" as const,
    documentId,
    document,
    paragraphPreview,
    summary: document
      ? `Current document: ${document.title} (${document.pageCount ?? "unknown"} pages).`
      : `Current document id: ${documentId}.`,
  }
}
