import { Router } from "express"
import { deleteTab, listTabs, replaceTabs, updateTab } from "../services/tabs.js"

export const tabsRouter = Router()

tabsRouter.get("/", (_req, res) => {
  res.json({ items: listTabs() })
})

tabsRouter.put("/", (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  res.json({ items: replaceTabs(items) })
})

tabsRouter.patch("/:id", (req, res) => {
  const updated = updateTab(req.params.id, req.body ?? {})
  if (!updated) {
    res.status(404).json({ message: "Tab not found" })
    return
  }
  res.json(updated)
})

tabsRouter.delete("/:id", (req, res) => {
  deleteTab(req.params.id)
  res.status(204).end()
})
