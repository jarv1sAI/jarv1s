<p align="center">
  <h1 align="center">JARV1S</h1>
  <p align="center">A local-first, portable AI agent with persistent identity, memory, and local network orchestration.</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.2.0-blue" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-green" alt="Node" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="License" />
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript" />
</p>

---

JARV1S is a CLI AI assistant that runs on your machine. It maintains a persistent identity and memory across sessions, executes tools on your behalf, and can be orchestrated across multiple devices on your local network — no cloud required.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [REPL Commands](#repl-commands)
- [Tools](#tools)
- [Image Input](#image-input)
- [Dashboard](#dashboard)
- [Peer Networking](#peer-networking)
- [Portability](#portability)
- [Memory & Storage](#memory--storage)
- [Configuration](#configuration)
- [License](#license)

---

## Features

- **Persistent Identity** — unique agent ID survives sessions and device transfers
- **Three-Layer Memory** — narrative memory (JARVIS.md), structured facts (SQLite), per-session conversation history
- **Streaming Responses** — text streams to the terminal as it's generated
- **10 Built-in Tools** — bash, file I/O, memory, directory listing, file search, web fetch, clipboard
- **Image Input** — pass image paths inline for multi-modal queries
- **Iron Man HUD Dashboard** — local browser UI with arc reactor orb, live stats, streaming chat, peer management, and portability controls
- **Local Network Peers** — discover and query other JARVIS instances on the LAN via mDNS, no config needed
- **Portability** — export full identity + memory to a `.jarvis.bundle` file; import on any device; live sync from a running peer
- **Two Providers** — Ollama (local, default) or subprocess (pipe through any CLI tool that already has its own auth — zero API keys in JARVIS)
- **Project Awareness** — auto-detects project type and git state, injects into context
- **Safe by Default** — bash commands and file overwrites require explicit confirmation
- **Sensitive Data Redaction** — strips API keys and tokens before sending to the model
- **Retry with Backoff** — automatically retries transient API errors

---

## Requirements

| Component | Minimum |
|-----------|---------|
| Node.js | 20.0.0+ |
| RAM | 512 MB |
| Disk | 100 MB |
| API Key | None required for Ollama or subprocess |

---

## Installation

```bash
git clone https://github.com/jarvisai/jarv1s
cd jarv1s
npm install
npm run build
```

Optionally link as a global command:

```bash
npm link
jarvis "hello"
```

---

## Usage

```bash
# One-shot query
jarvis "What is in my current directory?"

# Interactive REPL
jarvis

# Use a specific model for this invocation
jarvis --model qwen2.5-coder "refactor this function"

# Run health checks
jarvis doctor

# Open the web dashboard
jarvis dashboard
jarvis dashboard --port 8080

# Start peer daemon (for multi-device orchestration)
jarvis peer
jarvis peer --port 7474

# List JARVIS instances on the local network
jarvis peers

# Send a query to a peer instance
jarvis ask 192.168.1.10:7474 "what files are in your home dir?"

# Development (no build step)
npm run dev "summarise my git log"
```

---

## REPL Commands

Once in interactive mode, the following slash commands are available:

| Command | Description |
|---------|-------------|
| `/memory` | Display all stored facts |
| `/history` | Browse recent conversation history |
| `/forget <key>` | Delete a stored fact by key |
| `/clear` | Clear the terminal screen |
| `/exit` | Quit JARV1S |

---

## Tools

JARV1S exposes tools to the model. Destructive operations require confirmation before execution.

| Tool | Description | Confirmation |
|------|-------------|:---:|
| `bash_exec` | Execute a bash command | Yes |
| `read_file` | Read the contents of a file | No |
| `write_file` | Write content to a file | If file exists |
| `remember` | Store a key/value fact in persistent memory | No |
| `recall` | Search stored facts by keyword | No |
| `list_directory` | List files in a directory (optionally recursive) | No |
| `search_files` | Search file names (glob) or contents (text) | No |
| `web_fetch` | Fetch and return text content from a URL | No |
| `clipboard_read` | Read the current system clipboard contents | No |
| `clipboard_write` | Write text to the system clipboard | No |

> Tools are available with the `ollama` provider. With `subprocess`, the external CLI handles tool use on its own.

---

## Image Input

Pass image file paths inside angle brackets anywhere in your query:

```bash
# One-shot
jarvis "what's wrong with this UI? <./screenshots/bug.png>"

# REPL
> describe the architecture diagram <./docs/arch.png> and suggest improvements
```

Supported formats: PNG, JPEG, GIF, WebP.

---

## Dashboard

JARV1S includes a local web dashboard with an Iron Man HUD aesthetic:

```bash
jarvis dashboard          # Opens at http://127.0.0.1:4444
jarvis dashboard --port 8080
```

The dashboard provides:

- **Home** — arc reactor orb that animates with chat state (idle / thinking / responding), live HUD stats strip, streaming chat
- **Memory** — browse, search, and delete stored facts
- **History** — searchable conversation log with session filtering
- **Peers** — live list of discovered LAN peers with relay chat (query a remote JARVIS directly from the browser)
- **Portability** — one-click bundle export, peer sync UI
- **System** — identity info, provider config, storage stats

---

## Peer Networking

JARV1S instances on the same local network can discover and query each other automatically using mDNS — no IP addresses, no config files, no port forwarding required.

### Starting a peer

```bash
# Device A — start the peer daemon (default port 7474)
jarvis peer

# Custom port
jarvis peer --port 9000
```

The peer daemon:
- Advertises itself via mDNS as `_jarvis._tcp`
- Exposes an HTTP API for status, queries, and fact sync
- Streams responses as SSE

### Discovering peers

```bash
# Device B — scan the LAN for 3 seconds
jarvis peers
```

Example output:
```
Scanning local network for JARVIS peers (3s)...
Found 2 peer(s):

  192.168.1.10:7474  jarvis-a1b2c3...  (v2.2.0)
  192.168.1.22:7474  jarvis-d4e5f6...  (v2.2.0)
```

### Querying a peer

```bash
jarvis ask 192.168.1.10:7474 "summarise your recent git log"
jarvis ask 192.168.1.10:7474 "what processes are using the most CPU?"
```

### Peer API reference

Each peer daemon exposes the following endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Identity, provider config, and stats |
| `POST` | `/query` | Run a query — streams SSE response tokens |
| `GET` | `/peers` | List peers discovered by this instance |
| `GET` | `/sync/facts` | Dump all stored facts (JSON) |
| `POST` | `/sync/facts` | Receive facts from a remote (no-overwrite merge) |
| `GET` | `/sync/memory` | Dump JARVIS.md narrative memory (plain text) |

### Dashboard Peers panel

When the dashboard is open, it automatically scans for peers every 10 seconds. The Peers panel shows a live card for each discovered instance and includes a relay chat interface — select a peer, type a query, and stream its response directly in the browser.

---

## Portability

JARV1S can export its full state to a single portable file and import it on any other device.

### Export

```bash
# Export everything (identity, facts, memory, history, config)
jarvis export

# Custom output path
jarvis export --out ~/my-jarvis.jarvis.bundle

# Exclude conversation history (smaller file)
jarvis export --no-history
```

The bundle is a gzip-compressed JSON file containing your agent identity, all stored facts, JARVIS.md narrative memory, conversation history, and config.

### Import

```bash
# Import on a new device — merges data, keeps new device's own identity
jarvis import my-jarvis.jarvis.bundle

# Become the exact same agent (same ID) on the new device
jarvis import my-jarvis.jarvis.bundle --adopt-identity

# Skip conversation history
jarvis import my-jarvis.jarvis.bundle --no-history

# Skip overwriting jarvis.yaml (keep current provider settings)
jarvis import my-jarvis.jarvis.bundle --no-config
```

Import is always additive — existing local facts and memory are never overwritten.

### Live sync from a peer

```bash
# Pull facts + memory + history from a running peer on the LAN
jarvis sync 192.168.1.10:7474
```

### Typical workflows

**Setting up a new machine:**
```bash
# On old machine
jarvis export --out jarvis.jarvis.bundle
# Copy to new machine (USB, AirDrop, scp, etc.)

# On new machine
jarvis import jarvis.jarvis.bundle --adopt-identity
```

**Keeping two machines in sync:**
```bash
# On machine A (run once, stays running)
jarvis peer

# On machine B, pull latest from A
jarvis sync 192.168.1.10:7474
```

---

## Memory & Storage

All runtime data is stored locally in `~/.jarvis/`:

```
~/.jarvis/
├── identity/
│   └── jarvis.id               # Agent UUID, version, creation date
├── memory/
│   ├── JARVIS.md               # Narrative memory (human-editable)
│   └── interactions.db         # SQLite: facts + conversation history
├── state/
│   ├── session/
│   │   └── current.json        # Active session metadata
│   └── checkpoints/            # Reserved for future restore points
└── config/
    └── jarvis.yaml             # Provider and model configuration
```

**JARVIS.md** is the agent's long-term narrative. Edit it directly to adjust personality, preferences, or inject permanent context.

**interactions.db** holds two tables:
- `facts` — key/value pairs stored via the `remember` tool, searchable via `recall`
- `conversations` — per-session message history, loaded at startup and browsable via `/history`

---

## Configuration

### Config file

On first run, JARV1S creates `~/.jarvis/config/jarvis.yaml`:

```yaml
# Provider: ollama | subprocess
provider: ollama

# Model (for Ollama)
model: llama3.2

# Optional: override the Ollama endpoint
# base_url: http://localhost:11434/v1

max_tokens: 8096
stream: true
```

### Providers

| Provider | Description | Key required |
|----------|-------------|:---:|
| `ollama` | Local models via [Ollama](https://ollama.com) — default | No |
| `subprocess` | Pipe through any local CLI that already has its own auth | No |

#### Ollama (default)

```bash
ollama pull llama3.2
ollama pull qwen2.5-coder  # better for coding tasks
```

```yaml
provider: ollama
model: llama3.2
```

Recommended models for tool use: `llama3.2`, `qwen2.5`, `mistral-nemo`, `gemma3`.

#### subprocess — use any local agent's existing auth

The `subprocess` provider pipes queries through any CLI tool that already has its own authentication. No API key is stored in JARVIS — the tool handles auth entirely.

```yaml
provider: subprocess
subprocess_cmd: "claude -p"
```

The full prompt is appended as the last shell argument. The command must be on your `PATH` and already authenticated.

Examples:

```yaml
# Use your Claude Code login
subprocess_cmd: "claude -p"

# Use a specific model via Claude Code
subprocess_cmd: "claude -p --model claude-opus-4-6"

# Use ShellGPT
subprocess_cmd: "sgpt"

# Any CLI that accepts a prompt as its last argument
subprocess_cmd: "my-local-agent --verbose"
```

Per-invocation override:

```bash
jarvis --provider subprocess "explain this code"
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `JARVIS_PROVIDER` | Override the provider (`ollama` or `subprocess`) |
| `JARVIS_MODEL` | Override the model |
| `JARVIS_BASE_URL` | Override the Ollama API endpoint |
| `JARVIS_API_KEY` | API key override (if your Ollama instance requires one) |

Run `jarvis doctor` at any time to check configuration, storage health, and tool availability.

---

## License

MIT
