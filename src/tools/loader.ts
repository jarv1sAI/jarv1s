/**
 * Dynamic tool loader — scans ~/.jarvis/tools/*.js at startup and registers
 * any valid tool modules alongside the built-in tools.
 *
 * A tool module must export:
 *   - definition: { name, description, input_schema }
 *   - execute(input): Promise<string> | string
 *
 * Example ~/.jarvis/tools/hello.js:
 *   export const definition = {
 *     name: 'hello',
 *     description: 'Say hello',
 *     input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
 *   };
 *   export async function execute(input) {
 *     return `Hello, ${input.name}!`;
 *   }
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ToolModule {
  definition: {
    name: string;
    description: string;
    input_schema: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
  execute(input: Record<string, unknown>): Promise<string> | string;
}

const TOOLS_DIR = join(homedir(), '.jarvis', 'tools');

/** Loaded external tools, keyed by tool name. */
const _externalTools = new Map<string, ToolModule>();

/**
 * Load all *.js files from ~/.jarvis/tools/.
 * Silently skips files that don't export a valid definition + execute.
 * Called once at startup via initToolConfig().
 */
export async function loadExternalTools(): Promise<void> {
  if (!existsSync(TOOLS_DIR)) return;

  let entries: string[];
  try {
    entries = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.js'));
  } catch {
    return;
  }

  for (const file of entries) {
    const filePath = join(TOOLS_DIR, file);
    try {
      // Dynamic import — Node resolves absolute paths with file:// protocol
      const mod = (await import(`file://${filePath}`)) as Partial<ToolModule>;

      if (
        typeof mod.definition?.name !== 'string' ||
        typeof mod.definition.description !== 'string' ||
        typeof mod.execute !== 'function'
      ) {
        process.stderr.write(`[JARVIS] Skipping external tool ${file}: missing definition.name, description, or execute()\n`);
        continue;
      }

      const name = mod.definition.name;
      _externalTools.set(name, mod as ToolModule);
      process.stderr.write(`[JARVIS] Loaded external tool: ${name} (${file})\n`);
    } catch (err: unknown) {
      const e = err as { message?: string };
      process.stderr.write(`[JARVIS] Failed to load external tool ${file}: ${e.message ?? 'unknown error'}\n`);
    }
  }
}

/** Returns tool definitions for all loaded external tools. */
export function getExternalToolDefinitions(): ToolModule['definition'][] {
  return Array.from(_externalTools.values()).map((t) => t.definition);
}

/** Execute an external tool by name. Returns null if not found. */
export async function executeExternalTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string | null> {
  const tool = _externalTools.get(name);
  if (!tool) return null;
  try {
    return await tool.execute(input);
  } catch (err: unknown) {
    const e = err as { message?: string };
    return `Error in external tool ${name}: ${e.message ?? 'unknown error'}`;
  }
}

/** Whether any external tool with the given name is registered. */
export function hasExternalTool(name: string): boolean {
  return _externalTools.has(name);
}
