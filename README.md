# READMEClaw Desktop

READMEClaw is a local-first desktop research workbench. This branch now includes a local agent runtime with:

- thread-based chat sessions
- run-based execution and event persistence
- local read tools for documents, workspace data, notes, and KG
- approval-gated write tools for notes, KG, and library tags

The local runtime serves both the frontend app and the desktop shell on `http://127.0.0.1:4242` by default.

## Runtime Overview

- `threads` remain the long-lived chat container.
- `runs` represent one execution attempt for a user message.
- `agent_run_events` persist streaming lifecycle events such as `thinking`, `step`, `tool_call`, `proposal`, and `final`.
- `agent_proposals` persist approval-gated mutating operations.

Primary generation endpoint:

- `POST /threads/:id/runs/stream`

Supporting endpoints:

- `GET /runs/:id`
- `GET /runs/:id/events`
- `POST /runs/:id/abort`
- `GET /proposals`
- `POST /proposals/:id/action`
