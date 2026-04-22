export const schemaSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS remote_documents (
  remote_id TEXT PRIMARY KEY,
  remote_updated_at TEXT,
  remote_deleted_at TEXT,
  payload_json TEXT NOT NULL,
  title TEXT NOT NULL,
  page_count INTEGER,
  uploaded_at TEXT,
  process_status TEXT,
  html_status TEXT,
  last_synced_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'clean',
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS remote_notes (
  remote_id INTEGER PRIMARY KEY,
  remote_updated_at TEXT,
  remote_deleted_at TEXT,
  payload_json TEXT NOT NULL,
  title TEXT,
  pdf_remote_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  last_synced_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'clean',
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS remote_highlights (
  remote_id TEXT PRIMARY KEY,
  remote_updated_at TEXT,
  remote_deleted_at TEXT,
  payload_json TEXT NOT NULL,
  pdf_remote_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  color TEXT,
  created_at TEXT,
  last_synced_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'clean',
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS remote_graph_projects (
  remote_id TEXT PRIMARY KEY,
  remote_updated_at TEXT,
  remote_deleted_at TEXT,
  payload_json TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT,
  last_synced_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'clean',
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS remote_graph_nodes (
  remote_id TEXT PRIMARY KEY,
  remote_updated_at TEXT,
  remote_deleted_at TEXT,
  project_remote_id TEXT,
  payload_json TEXT NOT NULL,
  label TEXT NOT NULL,
  last_synced_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'clean',
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS remote_graph_edges (
  remote_id TEXT PRIMARY KEY,
  remote_updated_at TEXT,
  remote_deleted_at TEXT,
  project_remote_id TEXT,
  payload_json TEXT NOT NULL,
  source_remote_id TEXT NOT NULL,
  target_remote_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  last_synced_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'clean',
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS workspace_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parent_id TEXT REFERENCES workspace_nodes(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  color TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_document_links (
  workspace_id TEXT NOT NULL REFERENCES workspace_nodes(id) ON DELETE CASCADE,
  remote_document_id TEXT NOT NULL REFERENCES remote_documents(remote_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, remote_document_id)
);

CREATE TABLE IF NOT EXISTS workspace_note_links (
  workspace_id TEXT NOT NULL REFERENCES workspace_nodes(id) ON DELETE CASCADE,
  remote_note_id INTEGER NOT NULL REFERENCES remote_notes(remote_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, remote_note_id)
);

CREATE TABLE IF NOT EXISTS workspace_graph_links (
  workspace_id TEXT NOT NULL REFERENCES workspace_nodes(id) ON DELETE CASCADE,
  remote_graph_project_id TEXT NOT NULL REFERENCES remote_graph_projects(remote_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, remote_graph_project_id)
);

CREATE TABLE IF NOT EXISTS local_chat_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspace_nodes(id) ON DELETE SET NULL,
  document_remote_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES local_chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES local_chat_threads(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  model TEXT,
  context_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_proposals (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  thread_id TEXT NOT NULL REFERENCES local_chat_threads(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_type_label TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  args_json TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,
  review_comment TEXT,
  execution_result_json TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  executed_at TEXT
);

CREATE TABLE IF NOT EXISTS local_chat_message_meta (
  message_id TEXT PRIMARY KEY REFERENCES local_chat_messages(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  citations_json TEXT,
  thoughts_json TEXT,
  steps_json TEXT,
  attachments_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS open_tabs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  resource_remote_id TEXT,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_assets (
  id TEXT PRIMARY KEY,
  remote_document_id TEXT NOT NULL REFERENCES remote_documents(remote_id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  remote_document_id TEXT NOT NULL REFERENCES remote_documents(remote_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  page_number INTEGER,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  id UNINDEXED,
  remote_document_id UNINDEXED,
  page_number UNINDEXED,
  content
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  input_value TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  resource_name TEXT PRIMARY KEY,
  cursor_value TEXT,
  last_synced_at TEXT,
  last_error TEXT
);
`
