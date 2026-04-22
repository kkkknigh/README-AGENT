import { Router } from "express"
import { LOCAL_USER, changePassword, createApiKey, deleteApiKey, getApiKeys, getProfile, getStats, resetLocalAccount, updateProfile } from "../services/profile.js"

export const profileRouter = Router()

profileRouter.get("/me", (_req, res) => {
  const profile = getProfile()
  res.json({
    id: LOCAL_USER.id,
    username: profile.username,
    email: LOCAL_USER.email,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    preferences: profile.preferences,
    createdAt: profile.createdAt,
  })
})

profileRouter.put("/me", (req, res) => {
  const profile = updateProfile({
    username: req.body.username == null ? undefined : String(req.body.username),
    bio: req.body.bio === undefined ? undefined : (req.body.bio === null ? null : String(req.body.bio)),
    avatarUrl: req.body.avatarUrl === undefined ? undefined : (req.body.avatarUrl === null ? null : String(req.body.avatarUrl)),
    preferences: req.body.preferences && typeof req.body.preferences === "object" ? req.body.preferences : undefined,
  })
  res.json({
    id: LOCAL_USER.id,
    username: profile.username,
    email: LOCAL_USER.email,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    preferences: profile.preferences,
    createdAt: profile.createdAt,
  })
})

profileRouter.post("/password", (req, res, next) => {
  try {
    changePassword(
      req.body.oldPassword == null ? undefined : String(req.body.oldPassword),
      req.body.newPassword == null ? undefined : String(req.body.newPassword),
    )
    res.json({ message: "Password updated" })
  } catch (error) {
    next(error)
  }
})

profileRouter.get("/stats", (_req, res) => {
  res.json(getStats())
})

profileRouter.delete("/me", (_req, res) => {
  resetLocalAccount()
  res.json({ message: "Account data reset" })
})

profileRouter.get("/api-keys", (_req, res) => {
  const apiKeys = getApiKeys().map(({ apiKey: _apiKey, ...item }) => item)
  res.json({ apiKeys, expiredKeys: [], total: apiKeys.length, maxAllowed: 20 })
})

profileRouter.post("/api-keys", (req, res) => {
  const created = createApiKey(
    req.body.name == null ? undefined : String(req.body.name),
    req.body.expiresInDays == null ? null : Number(req.body.expiresInDays),
  )
  res.status(201).json({
    apiKey: created.apiKey,
    id: created.id,
    name: created.name,
    expiresAt: created.expiresAt,
    createdAt: created.createdAt,
  })
})

profileRouter.delete("/api-keys/:id", (req, res) => {
  deleteApiKey(req.params.id)
  res.json({ message: "Deleted" })
})
