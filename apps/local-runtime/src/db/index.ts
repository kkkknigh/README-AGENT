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

const ftsColumns = db.prepare(`PRAGMA table_info(document_chunks_fts)`).all() as Array<{ name: string }>
if (ftsColumns.length > 0 && !ftsColumns.some((column) => column.name === "page_number")) {
  db.exec(`
    DROP TABLE document_chunks_fts;
    CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
      id UNINDEXED,
      remote_document_id UNINDEXED,
      page_number UNINDEXED,
      content
    );
  `)
  db.prepare(`
    INSERT INTO document_chunks_fts (id, remote_document_id, page_number, content)
    SELECT id, remote_document_id, page_number, content
    FROM document_chunks
  `).run()
}
