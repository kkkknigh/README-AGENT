import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const children = []
let shuttingDown = false
const scriptDir = dirname(fileURLToPath(import.meta.url))

function ensureFrontendDist() {
  const distDir = resolve(scriptDir, "../apps/frontend/dist")
  mkdirSync(distDir, { recursive: true })

  const placeholderPath = resolve(distDir, "index.html")
  writeFileSync(
    placeholderPath,
    "<!doctype html><title>READMEClaw</title><body>Development server is starting.</body>\n",
    { flag: "wx" },
  )
}

function spawnCommand(command, label) {
  const child = spawn(command, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  })

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
    console.error(`[tauri-dev] ${label} exited with ${reason}`)
    shutdown(code ?? 1)
  })

  child.on("error", (error) => {
    if (shuttingDown) {
      return
    }

    console.error(`[tauri-dev] failed to start ${label}:`, error)
    shutdown(1)
  })

  children.push(child)
  return child
}

function killChild(child) {
  if (child.killed || child.exitCode != null) {
    return
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    })
    killer.on("error", () => {
      child.kill()
    })
    return
  }

  child.kill("SIGTERM")
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children) {
    killChild(child)
  }

  setTimeout(() => {
    process.exit(exitCode)
  }, 200)
}

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

try {
  ensureFrontendDist()
} catch (error) {
  if (error?.code !== "EEXIST") {
    throw error
  }
}

spawnCommand("npm run dev --workspace @readmeclaw/local-runtime", "local-runtime")
spawnCommand("npm run dev --workspace @readmeclaw/frontend-app", "frontend")
