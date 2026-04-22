import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { schemaSql } from "./schema.js"
import { getRuntimeDataDir, repoRoot } from "../config.js"

const dbPath = resolve(repoRoot, getRuntimeDataDir(), "db.sqlite")
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.exec(schemaSql)
