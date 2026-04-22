# Local Agent Runtime Guide

## Main Flow

1. The frontend creates or reuses a `thread`.
2. Message generation starts through `POST /threads/:id/runs/stream`.
3. The runtime creates an `agent_run`, persists events, and streams SSE updates.
4. In `agent` mode the planner may select a local tool.
5. Readonly tools execute immediately; mutating tools create a pending proposal.
6. Proposal approval executes the tool through the shared dispatcher.

## Key Modules

- `apps/local-runtime/src/agent-runtime`
  - orchestration, planning, tool dispatch, abort handling
- `apps/local-runtime/src/providers`
  - OpenAI-compatible chat/vision access and stream parsing
- `apps/local-runtime/src/tools`
  - tool registry and risk metadata
- `apps/local-runtime/src/proposals`
  - approval policy and execution
- `apps/local-runtime/src/repositories`
  - run, event, proposal, and message-meta persistence

## Current Tooling Scope

Readonly tools:

- `document.search_chunks`
- `document.get_paragraphs`
- `document.get_layout`
- `document.explain_overlay`
- `library.list_documents`
- `workspace.list_documents`
- `notes.list`
- `kg.get_project`

Approval-gated tools:

- `notes.create`
- `notes.update`
- `kg.create_node`
- `kg.create_edge`
- `library.add_tag`
- `library.remove_tag`
