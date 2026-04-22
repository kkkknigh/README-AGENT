import { Router } from "express"
import { LOCAL_USER } from "../services/profile.js"

export const authRouter = Router()

authRouter.post("/register", (_req, res) => {
  res.json({ message: "Registered locally" })
})

authRouter.post("/verify-register", (_req, res) => {
  res.json({ accessToken: "desktop-local-token", user: LOCAL_USER })
})

authRouter.post("/resend-code", (_req, res) => {
  res.json({ message: "Sent" })
})

authRouter.post("/forgot-password", (_req, res) => {
  res.json({ message: "Sent" })
})

authRouter.post("/reset-password", (_req, res) => {
  res.json({ message: "Reset" })
})

authRouter.post("/login", (_req, res) => {
  res.json({ accessToken: "desktop-local-token", user: LOCAL_USER })
})

authRouter.post("/logout", (_req, res) => {
  res.json({ message: "Logged out" })
})

authRouter.get("/me", (_req, res) => {
  res.json(LOCAL_USER)
})

authRouter.post("/refresh-token", (_req, res) => {
  res.json({ accessToken: "desktop-local-token", user: LOCAL_USER })
})

authRouter.post("/login/api-key", (_req, res) => {
  res.json({ accessToken: "desktop-local-token", user: LOCAL_USER })
})
