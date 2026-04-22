import { Router } from "express"
import { createNote, deleteNote, listNotes, updateNote } from "../services/notes.js"

export const notesRouter = Router()

notesRouter.get("/", (req, res) => {
  const pdfId = req.query.pdfId == null ? undefined : String(req.query.pdfId)
  const notes = listNotes(pdfId)
  res.json({ success: true, notes: notes.map(({ pdfId: _pdfId, ...note }) => note), total: notes.length })
})

notesRouter.post("/", (req, res) => {
  const note = createNote({
    pdfId: String(req.body.pdfId ?? ""),
    title: req.body.title == null ? undefined : String(req.body.title),
    content: String(req.body.content ?? ""),
    tags: Array.isArray(req.body.tags) ? req.body.tags.map(String) : [],
  })
  res.status(201).json({ success: true, message: "Created", id: note.id })
})

notesRouter.patch("/:id", (req, res) => {
  const note = updateNote(Number(req.params.id), {
    title: req.body.title == null ? undefined : String(req.body.title),
    content: req.body.content == null ? undefined : String(req.body.content),
    tags: Array.isArray(req.body.tags) ? req.body.tags.map(String) : undefined,
  })
  if (!note) {
    res.status(404).json({ message: "Note not found" })
    return
  }
  res.json({ success: true, message: "Updated" })
})

notesRouter.delete("/:id", (req, res) => {
  deleteNote(Number(req.params.id))
  res.json({ success: true, message: "Deleted" })
})
