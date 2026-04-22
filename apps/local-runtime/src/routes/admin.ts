import { Router } from "express"
import { batchDeleteInviteCodes, createInviteCodes, deleteInviteCode, deleteUser, getDashboard, listInviteCodes, listUsers, updateInviteCode, updateUser } from "../services/admin.js"

export const adminRouter = Router()

adminRouter.get("/dashboard", (_req, res) => {
  res.json(getDashboard())
})

adminRouter.get("/users", (req, res) => {
  res.json(listUsers({
    page: req.query.page == null ? undefined : Number(req.query.page),
    perPage: req.query.perPage == null ? undefined : Number(req.query.perPage),
    search: req.query.search == null ? undefined : String(req.query.search),
    role: req.query.role == null ? undefined : String(req.query.role),
    isActive: req.query.isActive == null ? undefined : String(req.query.isActive),
  }))
})

adminRouter.patch("/users/:id", (req, res) => {
  res.json(updateUser(req.params.id, {
    role: req.body.role == null ? undefined : String(req.body.role),
    isActive: req.body.isActive == null ? undefined : Boolean(req.body.isActive),
  }))
})

adminRouter.delete("/users/:id", (req, res) => {
  res.json(deleteUser(req.params.id))
})

adminRouter.get("/invite-codes", (req, res) => {
  res.json(listInviteCodes({
    page: req.query.page == null ? undefined : Number(req.query.page),
    perPage: req.query.perPage == null ? undefined : Number(req.query.perPage),
    search: req.query.search == null ? undefined : String(req.query.search),
    batch: req.query.batch == null ? undefined : Number(req.query.batch),
  }))
})

adminRouter.post("/invite-codes", (req, res) => {
  res.status(201).json(createInviteCodes({
    owner: req.body.owner == null ? undefined : String(req.body.owner),
    remainingUses: req.body.remainingUses == null ? undefined : Number(req.body.remainingUses),
    batch: req.body.batch == null ? undefined : Number(req.body.batch),
    count: req.body.count == null ? undefined : Number(req.body.count),
  }))
})

adminRouter.patch("/invite-codes/:id", (req, res) => {
  res.json(updateInviteCode(Number(req.params.id), {
    remainingUses: Number(req.body.remainingUses ?? 0),
  }))
})

adminRouter.delete("/invite-codes/:id", (req, res) => {
  res.json(deleteInviteCode(Number(req.params.id)))
})

adminRouter.post("/invite-codes/batch-delete", (req, res) => {
  res.json(batchDeleteInviteCodes(Array.isArray(req.body.ids) ? req.body.ids.map(Number) : []))
})
