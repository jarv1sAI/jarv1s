import { bashExec, bashExecDefinition, setBashBroker, type BashExecInput } from './bash.js';
import {
  readFile, writeFile, setFilesAllowedPaths, setFilesBroker,
  readFileDefinition, writeFileDefinition,
  type ReadFileInput, type WriteFileInput,
} from './files.js';
import {
  remember, recall,
  rememberDefinition, recallDefinition,
  type RememberInput, type RecallInput,
} from './memory.js';
import {
  listDirectory, searchFiles, setFsAllowedPaths,
  listDirectoryDefinition, searchFilesDefinition,
  type ListDirectoryInput, type SearchFilesInput,
} from './fs.js';
import {
  webFetch,
  webFetchDefinition,
  type WebFetchInput,
} from './web.js';
import {
  clipboardRead, clipboardWrite,
  clipboardReadDefinition, clipboardWriteDefinition,
  type ClipboardReadInput, type ClipboardWriteInput,
} from './clipboard.js';
import { type ConfirmationBroker, DenyAllBroker, defaultBroker } from './confirmation.js';
import { logToolCall } from '../memory.js';
import { webSearch, webSearchDefinition, type WebSearchInput } from './search.js';
import { loadConfig } from '../config.js';
import {
  loadExternalTools, getExternalToolDefinitions, executeExternalTool, hasExternalTool,
} from './loader.js';

function buildTools() {
  const config = loadConfig();
  const base = [
    bashExecDefinition,
    readFileDefinition,
    writeFileDefinition,
    rememberDefinition,
    recallDefinition,
    listDirectoryDefinition,
    searchFilesDefinition,
    webFetchDefinition,
    clipboardReadDefinition,
    clipboardWriteDefinition,
  ];
  if (config.searxng_url) base.push(webSearchDefinition);
  // External tools are appended after loadExternalTools() resolves; TOOLS is
  // rebuilt lazily via getTools() for callers that need the full list.
  return base;
}

const _builtinTools = buildTools();

function filterDisabled<T extends { name: string }>(tools: T[]): T[] {
  const perms = loadConfig().tool_permissions;
  if (!perms) return tools;
  return tools.filter((t) => perms[t.name] !== false);
}

/** Returns all enabled tool definitions including dynamically loaded external tools. */
export function getTools() {
  return filterDisabled([..._builtinTools, ...getExternalToolDefinitions()]);
}

// Keep TOOLS as a static export for backwards-compat
export const TOOLS = _builtinTools;

/**
 * Call once at startup (in agent.ts / dashboard.ts) to propagate config to tools.
 *
 * @param allowedPaths  Restricts file tools to configured directories.
 * @param dashboard     When true, uses DenyAllBroker (no terminal) instead of the
 *                      default TTY-aware broker. Phase 2.3 will replace this with
 *                      a WebSocket-backed DashboardBroker.
 */
export function initToolConfig(
  allowedPaths: string[] | undefined,
  dashboard = false,
): void {
  setFilesAllowedPaths(allowedPaths);
  setFsAllowedPaths(allowedPaths);

  const broker: ConfirmationBroker = dashboard ? DenyAllBroker : defaultBroker();
  setBashBroker(broker);
  setFilesBroker(broker);

  // Load external tools from ~/.jarvis/tools/*.js (fire and forget — errors are logged)
  void loadExternalTools();
}

// Re-export for consumers that need to set a custom broker (e.g. WebSocket dashboard broker)
export { type ConfirmationBroker, DenyAllBroker, defaultBroker, setBashBroker, setFilesBroker };

type ToolInput =
  | BashExecInput
  | ReadFileInput
  | WriteFileInput
  | RememberInput
  | RecallInput
  | ListDirectoryInput
  | SearchFilesInput
  | WebFetchInput
  | ClipboardReadInput
  | ClipboardWriteInput
  | WebSearchInput;

export async function executeTool(name: string, input: ToolInput): Promise<string> {
  // Per-tool permission check
  const toolPerms = loadConfig().tool_permissions;
  if (toolPerms && Object.prototype.hasOwnProperty.call(toolPerms, name) && toolPerms[name] === false) {
    return `Tool '${name}' is disabled by tool_permissions in jarvis.yaml.`;
  }

  const start = Date.now();
  let result: string;
  switch (name) {
    case 'bash_exec':        result = await bashExec(input as BashExecInput); break;
    case 'read_file':        result = readFile(input as ReadFileInput); break;
    case 'write_file':       result = await writeFile(input as WriteFileInput); break;
    case 'remember':         result = remember(input as RememberInput); break;
    case 'recall':           result = recall(input as RecallInput); break;
    case 'list_directory':   result = listDirectory(input as ListDirectoryInput); break;
    case 'search_files':     result = searchFiles(input as SearchFilesInput); break;
    case 'web_fetch':        result = await webFetch(input as WebFetchInput); break;
    case 'clipboard_read':   result = clipboardRead(input as ClipboardReadInput); break;
    case 'clipboard_write':  result = await clipboardWrite(input as ClipboardWriteInput); break;
    case 'web_search':       result = await webSearch(input as WebSearchInput); break;
    default: {
      if (hasExternalTool(name)) {
        result = (await executeExternalTool(name, input as Record<string, unknown>)) ?? `Unknown tool: ${name}`;
      } else {
        result = `Unknown tool: ${name}`;
      }
      break;
    }
  }
  logToolCall(name, input, result, Date.now() - start);
  return result;
}
