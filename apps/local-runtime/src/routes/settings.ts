import { Router } from "express"
import { getRemoteSettings, saveRemoteSettings } from "../services/remote.js"

export const settingsRouter = Router()

settingsRouter.get("/remote", (_req, res) => {
  res.json(getRemoteSettings())
})

settingsRouter.put("/remote", (req, res) => {
  const settings = saveRemoteSettings({
    baseUrl: String(req.body.baseUrl ?? ""),
    accessToken: req.body.accessToken == null ? null : String(req.body.accessToken),
  })
  res.json(settings)
})
