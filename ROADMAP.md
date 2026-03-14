# JARVIS Roadmap

## Current State (v2.1.0)

A minimal but complete CLI AI assistant with:

- **Identity** - Persistent UUID across sessions
- **Memory** - SQLite storage for facts and conversations, JARVIS.md for narrative memory
- **Tools** - 5 core tools (bash_exec, read_file, write_file, remember, recall)
- **CLI** - One-shot mode and interactive REPL
- **Safety** - Bash commands require user confirmation

### Architecture

```
CLI (index.ts)
    ↓
Agent Loop (agent.ts)
    ↓
Claude API (claude-sonnet-4-5)
    ↓
Tools (tools/*.ts)
    ↓
Memory (memory.ts) ←→ SQLite + JARVIS.md
```

### What Works

- [x] Persistent identity generation and loading
- [x] SQLite-backed conversation history (last 20 messages)
- [x] Fact storage with upsert (remember) and search (recall)
- [x] JARVIS.md for narrative/preference memory
- [x] Tool execution loop (keeps calling tools until text response)
- [x] Bash execution with y/n confirmation
- [x] File read/write operations
- [x] One-shot and REPL modes

---

## Completed

### v1.1 - Quality of Life ✓

- [x] Streaming responses (show text as it arrives)
- [x] Better error handling and retries with exponential backoff
- [x] Configurable model selection
- [x] History browsing command (`/history`)
- [x] Fact deletion (`/forget <key>`)

### v1.2 - Enhanced Tools ✓

- [x] `list_directory` - List files in a directory
- [x] `search_files` - Glob/grep across files
- [x] `web_fetch` - Fetch and parse content from URLs
- [x] `clipboard` - Read/write system clipboard

### v1.3 - Context Awareness ✓

- [x] Auto-detect project type (package.json, Cargo.toml, pyproject.toml, etc.)
- [x] Load project-specific context into system prompt
- [x] Git awareness (current branch, recent commits, dirty state)
- [x] Working directory tracking
- [x] Sensitive data redaction (strip API keys, passwords before sending to API)

### v2.0 - Multi-Modal + Dashboard ✓

- [x] Image input support (pass image paths inline with queries)
- [x] Iron Man HUD web dashboard — arc reactor orb, streaming chat, live stats
- [x] `jarvis doctor` — health check command (API key, model, DB, storage)
- [x] Migrate `~/.jarvis/` to structured directory layout
- [x] Multi-provider support (Ollama, OpenAI, Anthropic, custom)

### v2.1 - Local Network Orchestration ✓

- [x] mDNS peer discovery — zero-config, auto-finds JARVIS instances on LAN
- [x] Peer daemon (`jarvis peer`) — HTTP API for status, queries, sync
- [x] `jarvis ask <host:port> <query>` — relay queries to remote instances
- [x] Streaming SSE response relay
- [x] Dashboard Peers panel — live peer cards, relay chat in browser

### v2.2 - Portability ✓

- [x] `jarvis export` — pack full identity + memory into a `.jarvis.bundle` file (gzip JSON)
- [x] `jarvis import` — unpack bundle onto new device, no-overwrite merge strategy
- [x] `--adopt-identity` flag — become the same agent across devices
- [x] `jarvis sync <host:port>` — live pull of facts, memory, and history from running peer
- [x] Dashboard Portability panel — one-click export download + peer sync UI
- [x] Peer `/sync/history` endpoint — full history available for sync

---

## Upcoming

### v2.3 - Security & Permissions

- [ ] Per-tool permission profiles (grant/deny tools per session or globally)
- [ ] Audit log of all tool executions with timestamps, stored in SQLite
- [ ] Container isolation for bash execution (Docker/Podman sandbox)
- [ ] Configurable command allowlist/denylist in `jarvis.yaml`
- [ ] Encrypted bundles for export/import (AES-256-GCM, passphrase-derived key)

### v3.0 - Memory & Intelligence

- [ ] Three-tier memory: short-term (context) + long-term (SQLite) + episodic (embeddings)
- [ ] Local vector embeddings for semantic fact search (`sqlite-vec`)
- [ ] Conversation compaction — auto-summarize old sessions into JARVIS.md
- [ ] Intent classification — fast lightweight model routes queries before main model
- [ ] Personality modes (Developer, Research, General) with distinct system prompts
- [ ] Session checkpoints and restore

### v3.1 - Sync & Continuity

- [ ] Git-based sync (optional, private repo as sync backend)
- [ ] Conflict resolution UI in dashboard for fact/memory merge conflicts
- [ ] Cryptographic identity signing (ed25519) — verify bundle authenticity
- [ ] Automatic background sync when peer daemon is running

### v4.0 - Skills & MCP

- [ ] Skills system — installable capability bundles (`~/.jarvis/skills/`)
- [ ] MCP server support (bring your own integrations)
- [ ] Skill manifest format (SKILL.md + manifest.json)
- [ ] Built-in skills: home-automation, code-review, research, note-taking
- [ ] `jarvis skill install/remove/list/update` commands

### v4.1 - Additional Interfaces

- [ ] Voice input/output (local STT/TTS via Whisper + Piper, fully offline)
- [ ] Channel integrations via skills (Telegram, Discord)
- [ ] `--daemon` mode for background operation with IPC
- [ ] REST + WebSocket API for programmatic access

### v5.0 - Learning & Adaptation

- [ ] Structured trace capture at every layer
- [ ] Prompt optimization from local interaction traces
- [ ] Hardware-tier aware model selection (8GB / 16GB / 32GB+ profiles)
- [ ] Closed-loop self-improvement pipeline from local data

---

## Non-Goals (until explicitly scoped)

- Cloud hosting or SaaS
- Mandatory cloud sync (always opt-in)
- Vendor-specific integrations in core (everything goes through skills/MCP)
- Web scraping at scale
