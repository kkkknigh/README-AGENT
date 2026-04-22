import { Router } from "express"
import { buildParagraphsFromMarkdown, getParsedDocument, inferPageCount, saveParsedDocument } from "../services/document-cache.js"
import { upsertDocument } from "../services/library.js"
import { parsePdfFileWithMineru, parseUrlWithMineru } from "../services/mineru.js"
import { syncDocumentChunks } from "../services/search.js"

export const importRouter = Router()

importRouter.post("/pdf", async (req, res, next) => {
  try {
    const filename = String(req.body.filename ?? "untitled.pdf")
    const contentBase64 = String(req.body.contentBase64 ?? "")
    const bytes = Uint8Array.from(Buffer.from(contentBase64, "base64"))
    const parsed = await parsePdfFileWithMineru({ filename, bytes })
    const paragraphs = buildParagraphsFromMarkdown(parsed.pdfId, parsed.markdown)
    const pageCount = inferPageCount(paragraphs)

    saveParsedDocument({
      pdfId: parsed.pdfId,
      filename,
      pageCount,
      markdown: parsed.markdown,
      paragraphs,
      layout: parsed.layout,
    })
    upsertDocument({
      id: parsed.pdfId,
      title: filename.replace(/\.pdf$/i, ""),
      pageCount,
      authors: [],
      tags: [],
      uploadedAt: new Date().toISOString(),
      processStatus: "completed",
      htmlStatus: "completed",
      metadata: { source: "upload" },
    })
    syncDocumentChunks(parsed.pdfId, paragraphs)

    res.status(202).json({
      pdfId: parsed.pdfId,
      filename,
      pageCount,
      fileHash: parsed.pdfId,
      isNewUpload: true,
      taskId: null,
      status: "completed",
      paragraphs,
      layout: parsed.layout,
    })
  } catch (error) {
    next(error)
  }
})

importRouter.post("/link", async (req, res, next) => {
  try {
    const input = String(req.body.input ?? "").trim()
    const parsed = await parseUrlWithMineru({ url: input })
    const paragraphs = buildParagraphsFromMarkdown(parsed.pdfId, parsed.markdown)
    const pageCount = inferPageCount(paragraphs)

    saveParsedDocument({
      pdfId: parsed.pdfId,
      filename: parsed.filename,
      pageCount,
      markdown: parsed.markdown,
      paragraphs,
      layout: parsed.layout,
    })
    upsertDocument({
      id: parsed.pdfId,
      title: parsed.filename,
      pageCount,
      authors: ["Web Import"],
      tags: ["imported"],
      uploadedAt: new Date().toISOString(),
      processStatus: "completed",
      htmlStatus: "completed",
      metadata: { source: "link", input },
    })
    syncDocumentChunks(parsed.pdfId, paragraphs)

    res.status(202).json({
      importTaskId: `import-${parsed.pdfId}`,
      status: "completed",
      input,
      pdfId: parsed.pdfId,
      filename: parsed.filename,
      pageCount,
      taskId: null,
      documentStatus: "completed",
      isNewUpload: true,
    })
  } catch (error) {
    next(error)
  }
})

importRouter.post("/link/:importTaskId/stream", (req, res) => {
  const pdfId = String(req.params.importTaskId).replace(/^import-/, "")
  const document = getParsedDocument(pdfId)

  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()

  if (!document) {
    res.write(`data: ${JSON.stringify({ type: "failed", status: "failed", error: "Import task not found", jobId: req.params.importTaskId })}\n\n`)
    res.write("data: [DONE]\n\n")
    res.end()
    return
  }

  res.write(`data: ${JSON.stringify({
    type: "snapshot",
    jobId: req.params.importTaskId,
    status: "completed",
    input: req.body.input ?? "",
    pdfId,
    filename: document.filename,
    pageCount: document.pageCount,
    documentStatus: "completed",
    isNewUpload: true,
  })}\n\n`)
  res.write(`data: ${JSON.stringify({
    type: "ready",
    jobId: req.params.importTaskId,
    status: "completed",
    pdfId,
    taskId: null,
    filename: document.filename,
    pageCount: document.pageCount,
    documentStatus: "completed",
    isNewUpload: true,
  })}\n\n`)
  res.write("data: [DONE]\n\n")
  res.end()
})
