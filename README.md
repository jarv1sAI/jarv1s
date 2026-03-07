# JARVIS

Local-first CLI AI assistant with persistent identity and memory.

## Features

- **Persistent Identity** - UUID stored across sessions
- **Memory** - SQLite-backed facts and conversation history
- **Tools** - Execute bash commands, read/write files, remember/recall info
- **Safe by Default** - Bash commands require y/n confirmation

## Setup

```bash
npm install
npm run build
```

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="sk-..."
```

## Usage

```bash
# One-shot mode
node dist/index.js "What files are in my home directory?"

# Interactive REPL
node dist/index.js

# Development
npm run dev "hello"
```

### REPL Commands

| Command | Description |
|---------|-------------|
| `/memory` | Show all stored facts |
| `/clear` | Clear screen |
| `/exit` | Quit |

## Tools

| Tool | Description |
|------|-------------|
| `bash_exec` | Execute bash commands (requires confirmation) |
| `read_file` | Read file contents |
| `write_file` | Write content to a file |
| `remember` | Store a fact in persistent memory |
| `recall` | Search memory for matching facts |

## Data Storage

Runtime data is stored in `~/.jarvis/`:

```
~/.jarvis/
├── identity.json   # UUID, version, creation date
├── JARVIS.md       # Narrative memory and preferences
└── memory.db       # SQLite (facts + conversations)
```

## License

MIT
