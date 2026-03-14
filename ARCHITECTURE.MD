# JARV1S Architecture

## Vision

A portable, local-first AI agent that maintains continuous identity and memory across devices. Not cloud-bound, not device-locked. Jarvis runs on your machine and moves with you.

## Core Principles

### 1. Sovereignty
- **Local-first execution**: All processing happens on your hardware
- **Data ownership**: You control your data, your memory, your agent
- **No forced cloud**: Cloud services are opt-in, not required
- **Auditable**: Small enough codebase to understand and verify

### 2. Portability
- **Identity persistence**: Jarvis carries its identity across devices
- **Memory continuity**: Context and learnings transfer seamlessly
- **Config portability**: Settings, permissions, automations move with you
- **Zero data loss**: No sessions reset, no context lost

### 3. Security
- **Container isolation**: Agents run in sandboxed environments
- **Explicit permissions**: Only mounted directories are accessible
- **OS-level security**: Real isolation, not application-level allowlists
- **Minimal attack surface**: Small codebase = fewer vulnerabilities

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           JARVIS CORE                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │   Identity Core  │  │  Memory System   │  │  Cognition Engine │       │
│  │                  │  │                  │  │                  │       │
│  │  - UUID          │  │  - Short-term    │  │  - Context Mgmt  │       │
│  │  - Crypto Keys   │  │  - Long-term     │  │  - Compaction    │       │
│  │  - Permissions   │  │  - Episodic      │  │  - Reasoning     │       │
│  │  - Auth Tokens   │  │  - Semantic      │  │  - Tool Use      │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │   Sync Layer     │  │  Tool Registry   │  │  Skill System    │       │
│  │                  │  │                  │  │                  │       │
│  │  - State Export  │  │  - Built-in      │  │  - Installable   │       │
│  │  - State Import  │  │  - MCP Servers   │  │  - Composable    │       │
│  │  - Conflict Res  │  │  - Custom Tools  │  │  - Shareable     │       │
│  │  - Versioning    │  │  - Permissions   │  │  - Removable     │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                         INTERFACE LAYER                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │     CLI      │ │   REST API   │ │   WebSocket  │ │   Channels   │   │
│  │              │ │              │ │              │ │              │   │
│  │  Terminal    │ │  HTTP/JSON   │ │  Real-time   │ │  WhatsApp    │   │
│  │  Interface   │ │  Endpoints   │ │  Streaming   │ │  Telegram    │   │
│  │              │ │              │ │              │ │  Discord     │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                        INTEGRATION LAYER                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │   IoT Hub    │ │  Home Lab    │ │   Network    │ │  Automation  │   │
│  │              │ │              │ │              │ │              │   │
│  │  - MQTT      │ │  - Docker    │ │  - Firewall  │ │  - Cron      │   │
│  │  - Zigbee    │ │  - Proxmox   │ │  - DNS       │ │  - Webhooks  │   │
│  │  - Z-Wave    │ │  - Unraid    │ │  - VPN       │ │  - Scripts   │   │
│  │  - HomeKit   │ │  - Portainer │ │  - Monitoring│ │  - Workflows │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Memory Architecture

### Three-Tier Memory Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MEMORY SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    SHORT-TERM MEMORY                         │    │
│  │                   (Context Window)                           │    │
│  │                                                              │    │
│  │  - Active conversation context                               │    │
│  │  - Current task state                                        │    │
│  │  - Tool call results (ephemeral)                            │    │
│  │  - Working scratchpad                                        │    │
│  │                                                              │    │
│  │  Storage: In-memory (RAM)                                    │    │
│  │  Persistence: Session-scoped                                 │    │
│  │  Compaction: Automatic via Claude Agent SDK                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    LONG-TERM MEMORY                          │    │
│  │                   (Persistent Facts)                         │    │
│  │                                                              │    │
│  │  - User preferences & settings                               │    │
│  │  - Learned patterns & behaviors                              │    │
│  │  - Configuration history                                     │    │
│  │  - Skill-specific knowledge                                  │    │
│  │  - Cross-session summaries                                   │    │
│  │                                                              │    │
│  │  Storage: SQLite + Markdown files                            │    │
│  │  Persistence: Permanent (synced)                             │    │
│  │  Format: JARVIS.md + structured JSON                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    EPISODIC MEMORY                           │    │
│  │                   (Semantic Retrieval)                       │    │
│  │                                                              │    │
│  │  - Past interactions (vectorized)                            │    │
│  │  - Decision history & rationale                              │    │
│  │  - Task completion records                                   │    │
│  │  - Error patterns & solutions                                │    │
│  │  - Conversation embeddings                                   │    │
│  │                                                              │    │
│  │  Storage: SQLite + Vector DB (local)                         │    │
│  │  Retrieval: Semantic search                                  │    │
│  │  Indexing: Local embeddings (all-MiniLM-L6-v2)              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Memory File Structure

```
~/.jarvis/
├── identity/
│   ├── jarvis.id              # Unique agent identifier
│   ├── keys/                  # Cryptographic keys for sync
│   │   ├── private.pem
│   │   └── public.pem
│   └── permissions.json       # Access control lists
│
├── memory/
│   ├── JARVIS.md             # Core personality & preferences (human-readable)
│   ├── facts.json            # Structured learned facts
│   ├── interactions.db       # SQLite: conversation history
│   └── vectors/              # Local vector embeddings
│       └── episodic.idx
│
├── state/
│   ├── session/              # Active session data
│   │   └── current.json
│   ├── checkpoints/          # Recovery points
│   │   └── {timestamp}.snap
│   └── sync/                 # Sync state
│       ├── local.json
│       └── remote.json
│
├── skills/
│   ├── installed/            # Active skills
│   └── available/            # Downloaded but not active
│
├── tools/
│   ├── mcp-servers/          # MCP server configs
│   └── custom/               # Custom tool definitions
│
├── automations/
│   ├── schedules.json        # Cron-like tasks
│   └── workflows/            # Complex automation definitions
│
└── config/
    ├── jarvis.yaml           # Main configuration
    ├── channels.yaml         # Communication channel configs
    └── integrations.yaml     # External system configs
```

## Sync & Portability

### State Synchronization Protocol

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Device A  │         │  Sync Layer │         │   Device B  │
│   (Source)  │         │  (Protocol) │         │   (Target)  │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │  1. Export State      │                       │
       │──────────────────────>│                       │
       │                       │                       │
       │  2. Create Manifest   │                       │
       │  (checksums, versions)│                       │
       │<──────────────────────│                       │
       │                       │                       │
       │  3. Package Bundle    │                       │
       │  (encrypted, signed)  │                       │
       │──────────────────────>│                       │
       │                       │                       │
       │                       │  4. Transfer Bundle   │
       │                       │──────────────────────>│
       │                       │                       │
       │                       │  5. Verify Signature  │
       │                       │<──────────────────────│
       │                       │                       │
       │                       │  6. Decrypt & Extract │
       │                       │──────────────────────>│
       │                       │                       │
       │                       │  7. Resolve Conflicts │
       │                       │──────────────────────>│
       │                       │                       │
       │                       │  8. Apply State       │
       │                       │──────────────────────>│
       │                       │                       │
       │  9. Confirm Sync      │                       │
       │<──────────────────────┼───────────────────────│
       │                       │                       │
```

### Sync Mechanisms

1. **Local Network Sync** (Default)
   - mDNS discovery of Jarvis instances
   - Direct peer-to-peer transfer
   - No cloud required

2. **USB/Portable Media Sync**
   - Export to encrypted bundle file
   - Physical transfer via USB drive
   - Import on target device

3. **Git-Based Sync** (Optional)
   - Private repository as sync backend
   - Conflict resolution via merge strategies
   - Full history and rollback

4. **Cloud Sync** (Optional, Opt-in)
   - End-to-end encrypted
   - User-controlled server (Nextcloud, S3, etc.)
   - No vendor lock-in

### Identity Portability

```json
{
  "identity": {
    "id": "jarvis-{uuid}",
    "created": "2026-02-25T00:00:00Z",
    "version": "1.0.0",
    "signature": "{ed25519-signature}"
  },
  "capabilities": {
    "tools": ["bash", "file_ops", "web_search", "mcp"],
    "skills": ["home-automation", "code-review", "research"],
    "channels": ["cli", "websocket", "whatsapp"]
  },
  "memory_refs": {
    "facts": "sha256:{hash}",
    "interactions": "sha256:{hash}",
    "vectors": "sha256:{hash}"
  }
}
```

## Execution Model

### Container Isolation

```
┌───────────────────────────────────────────────────────────────┐
│                        HOST SYSTEM                             │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                    JARVIS ORCHESTRATOR                  │   │
│  │                   (Node.js Process)                     │   │
│  │                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │   Router    │  │  Scheduler  │  │  State Mgr  │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  │                                                         │   │
│  └────────────────────────┬───────────────────────────────┘   │
│                           │                                    │
│                           │ IPC (filesystem)                   │
│                           │                                    │
│  ┌────────────────────────▼───────────────────────────────┐   │
│  │               CONTAINER RUNTIME                         │   │
│  │        (Docker / Apple Container / Podman)              │   │
│  │                                                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │              AGENT CONTAINER                     │   │   │
│  │  │                                                  │   │   │
│  │  │  ┌──────────────────────────────────────────┐   │   │   │
│  │  │  │           Claude Agent SDK                │   │   │   │
│  │  │  │                                           │   │   │   │
│  │  │  │  - LLM Interface                          │   │   │   │
│  │  │  │  - Tool Execution                         │   │   │   │
│  │  │  │  - Context Management                     │   │   │   │
│  │  │  └──────────────────────────────────────────┘   │   │   │
│  │  │                                                  │   │   │
│  │  │  Mounted Volumes (explicit only):                │   │   │
│  │  │  ├── /jarvis/memory    (read/write)             │   │   │
│  │  │  ├── /jarvis/workspace (read/write)             │   │   │
│  │  │  └── /jarvis/config    (read-only)              │   │   │
│  │  │                                                  │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Core
- **Runtime**: Node.js 20+ / Bun
- **Language**: TypeScript (strict mode)
- **Agent SDK**: Claude Agent SDK (Python/TypeScript)
- **Database**: SQLite (better-sqlite3)
- **Vector Store**: sqlite-vss or lance

### Container
- **macOS**: Apple Container (preferred) or Docker
- **Linux**: Docker or Podman
- **Windows**: WSL2 + Docker

### Communication
- **API**: Fastify (REST + WebSocket)
- **IPC**: Filesystem-based (like NanoClaw)
- **Channels**: Pluggable via skills

### Sync
- **Crypto**: ed25519 (signing), AES-256-GCM (encryption)
- **Discovery**: mDNS/DNS-SD
- **Transfer**: Direct TCP or user-specified backend

## Skills System

Skills extend Jarvis without bloating the core. They're installed, not built-in.

### Skill Structure

```
skills/
└── home-automation/
    ├── SKILL.md           # Instructions for Claude
    ├── manifest.json      # Metadata & dependencies
    ├── tools/             # MCP servers or custom tools
    │   └── homeassistant.mcp.json
    ├── memory/            # Skill-specific memory templates
    │   └── devices.md
    └── tests/             # Validation tests
        └── skill.test.ts
```

### Skill Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Discovery  │────>│   Install   │────>│   Activate  │
│             │     │             │     │             │
│  - Registry │     │  - Download │     │  - Load     │
│  - Local    │     │  - Verify   │     │  - Register │
│  - URL      │     │  - Extract  │     │  - Test     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       │                                       ▼
       │                              ┌─────────────┐
       │                              │   Runtime   │
       │                              │             │
       │                              │  - Execute  │
       │                              │  - Monitor  │
       │                              │  - Unload   │
       │                              └─────────────┘
       │                                       │
       ▼                                       ▼
┌─────────────┐                       ┌─────────────┐
│   Update    │                       │   Remove    │
│             │                       │             │
│  - Check    │                       │  - Cleanup  │
│  - Migrate  │                       │  - Verify   │
│  - Replace  │                       │  - Confirm  │
└─────────────┘                       └─────────────┘
```

## Command Interface

### CLI Commands

```bash
# Core
jarvis                    # Start interactive session
jarvis "query"            # One-shot query
jarvis --daemon           # Run as background service

# Identity & Sync
jarvis identity show      # Display identity info
jarvis identity export    # Export for transfer
jarvis identity import    # Import from transfer
jarvis sync status        # Check sync state
jarvis sync push          # Push to sync target
jarvis sync pull          # Pull from sync source

# Memory
jarvis memory show        # Display memory summary
jarvis memory search      # Semantic search in memory
jarvis memory compact     # Trigger compaction
jarvis memory export      # Export memory bundle
jarvis memory import      # Import memory bundle

# Skills
jarvis skill list         # List installed skills
jarvis skill install      # Install a skill
jarvis skill remove       # Remove a skill
jarvis skill update       # Update skills

# Automation
jarvis schedule list      # List scheduled tasks
jarvis schedule add       # Add scheduled task
jarvis schedule remove    # Remove scheduled task

# System
jarvis status             # System status
jarvis logs               # View logs
jarvis config             # Edit configuration
jarvis doctor             # Run diagnostics
```

## Development Phases

### Phase 1: Foundation (MVP)
- [ ] Core orchestrator (single process)
- [ ] CLI interface
- [ ] Basic memory system (JARVIS.md + SQLite)
- [ ] Container isolation (Docker)
- [ ] Claude Agent SDK integration
- [ ] Local-only operation

### Phase 2: Persistence
- [ ] Full three-tier memory
- [ ] Vector embeddings (local)
- [ ] Session management
- [ ] Checkpoint/restore
- [ ] Basic export/import

### Phase 3: Portability
- [ ] Identity system
- [ ] USB sync
- [ ] Local network discovery
- [ ] Peer-to-peer sync
- [ ] Conflict resolution

### Phase 4: Integration
- [ ] Skills system
- [ ] MCP server support
- [ ] REST/WebSocket API
- [ ] First channel (WhatsApp or Telegram)
- [ ] Home automation skill

### Phase 5: Advanced
- [ ] Agent swarms
- [ ] Multi-device coordination
- [ ] Optional cloud sync
- [ ] Advanced automation
- [ ] Community skill registry

## Design Decisions

### Why TypeScript?
- Type safety for complex state management
- Same language as Claude Agent SDK (TS version)
- Rich ecosystem for tooling
- Easier to audit than dynamic languages

### Why SQLite?
- Zero configuration
- Portable (single file)
- ACID compliant
- Vector extensions available
- Battle-tested reliability

### Why Container Isolation?
- Real security, not permission checks
- Consistent environment across devices
- Easy to audit what's accessible
- Industry-standard approach

### Why Skills Over Features?
- Keeps core minimal and auditable
- Users only get what they need
- Easy to add/remove functionality
- Community can contribute without core changes

## Security Model

### Threat Model
1. **Prompt Injection**: Container isolation limits blast radius
2. **Data Exfiltration**: No network access unless explicitly granted
3. **Privilege Escalation**: Container runs as unprivileged user
4. **Supply Chain**: Minimal dependencies, all auditable

### Security Boundaries
- Host ↔ Container: Volume mounts only
- Container ↔ Network: Explicit allowlist
- User ↔ Jarvis: Permission system
- Jarvis ↔ External: Tool-level permissions

## Inspirations & References

- **NanoClaw**: Container isolation, minimal codebase, skills-over-features
- **Claude Agent SDK**: Agent loop, memory tool, context management
- **Obsidian**: Local-first, sync flexibility, plugin system
- **Iron Man's J.A.R.V.I.S.**: Continuous identity, multi-device, proactive assistance