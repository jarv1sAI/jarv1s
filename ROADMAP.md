# JARVIS Roadmap

## Current State (v1.0.0)

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

## Future Roadmap

### v1.1 - Quality of Life

- [ ] Streaming responses (show text as it arrives)
- [ ] Better error handling and retries
- [ ] Configurable model selection
- [ ] History browsing command (`/history`)
- [ ] Fact deletion (`/forget <key>`)

### v1.2 - Enhanced Tools

- [ ] `list_directory` - List files in a directory
- [ ] `search_files` - Glob/grep across files
- [ ] `web_fetch` - Fetch content from URLs
- [ ] `clipboard` - Read/write system clipboard

### v1.3 - Context Awareness

- [ ] Auto-detect project type (package.json, Cargo.toml, etc.)
- [ ] Load project-specific context into system prompt
- [ ] Git awareness (current branch, recent commits)
- [ ] Working directory tracking

### v2.0 - Multi-Modal

- [ ] Image input support
- [ ] Screenshot analysis
- [ ] PDF/document reading

---

## Non-Goals (for now)

These are explicitly out of scope to keep v1 simple:

- Containers / sandboxing
- Sync across machines
- Vector search / embeddings
- REST API / web interface
- Channels (Slack, Discord, etc.)
- Scheduling / cron jobs
- Multi-agent orchestration
