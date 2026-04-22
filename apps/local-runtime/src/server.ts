import cors from "cors"
import express from "express"
import { workspaceRouter } from "./routes/workspaces.js"
import { syncRouter } from "./routes/sync.js"
import { chatRouter } from "./routes/chat.js"
import { searchRouter } from "./routes/search.js"
import { importRouter } from "./routes/imports.js"
import { settingsRouter } from "./routes/settings.js"
import { tabsRouter } from "./routes/tabs.js"
import { documentsRouter } from "./routes/documents.js"
import { aiRouter } from "./routes/ai.js"
import { libraryRouter } from "./routes/library.js"
import { notesRouter } from "./routes/notes.js"
import { highlightsRouter } from "./routes/highlights.js"
import { kgRouter } from "./routes/kg.js"
import { profileRouter } from "./routes/profile.js"
import { authRouter } from "./routes/auth.js"
import { htmlRouter } from "./routes/html.js"
import { adminRouter } from "./routes/admin.js"
import { linksRouter } from "./routes/links.js"
import { proposalRouter } from "./routes/proposals.js"
import { runsRouter } from "./transport/routes/runs.js"
import "./db/index.js"
import { getRuntimeHost, getRuntimePort } from "./config.js"

const app = express()
const port = getRuntimePort()
const host = getRuntimeHost()

app.use(cors())
app.use(express.json({ limit: "50mb" }))

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "readmeclaw-local-runtime" })
})

app.use("/workspaces", workspaceRouter)
app.use("/settings", settingsRouter)
app.use("/sync", syncRouter)
app.use("/imports", importRouter)
app.use("/documents", documentsRouter)
app.use("/ai", aiRouter)
app.use("/library", libraryRouter)
app.use("/notes", notesRouter)
app.use("/highlights", highlightsRouter)
app.use("/kg", kgRouter)
app.use("/profile", profileRouter)
app.use("/auth", authRouter)
app.use("/html", htmlRouter)
app.use("/admin", adminRouter)
app.use("/links", linksRouter)
app.use("/proposals", proposalRouter)
app.use("/", runsRouter)
app.use("/tabs", tabsRouter)
app.use("/", chatRouter)
app.use("/search", searchRouter)

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ message: error.message })
})

app.listen(port, host, () => {
  console.log(`[local-runtime] listening on http://${host}:${port}`)
})
