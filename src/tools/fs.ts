import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// list_directory
// ---------------------------------------------------------------------------

export interface ListDirectoryInput {
  path: string;
  recursive?: boolean;
}

export function listDirectory(input: ListDirectoryInput): string {
  const { path, recursive = false } = input;

  if (!existsSync(path)) return `Error: Path not found: ${path}`;

  const stat = statSync(path);
  if (!stat.isDirectory()) return `Error: Not a directory: ${path}`;

  try {
    if (recursive) {
      const lines: string[] = [];
      function walk(dir: string, depth: number): void {
        if (depth > 8) return; // safety limit
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') && depth > 0) continue; // skip hidden in subdirs
          const full = join(dir, entry.name);
          const rel = relative(path, full);
          const suffix = entry.isDirectory() ? '/' : '';
          lines.push(rel + suffix);
          if (entry.isDirectory()) walk(full, depth + 1);
        }
      }
      walk(path, 0);
      return lines.length > 0 ? lines.join('\n') : '(empty directory)';
    } else {
      const entries = readdirSync(path, { withFileTypes: true });
      if (entries.length === 0) return '(empty directory)';
      return entries
        .map((e) => e.name + (e.isDirectory() ? '/' : ''))
        .join('\n');
    }
  } catch (err: unknown) {
    return `Error listing directory: ${(err as { message?: string }).message ?? String(err)}`;
  }
}

export const listDirectoryDefinition = {
  name: 'list_directory',
  description: 'List files and directories at a given path',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'The directory path to list' },
      recursive: { type: 'boolean', description: 'Whether to list recursively (default false)' },
    },
    required: ['path'],
  },
};

// ---------------------------------------------------------------------------
// search_files
// ---------------------------------------------------------------------------

export interface SearchFilesInput {
  pattern: string;
  path?: string;
  type?: 'glob' | 'text';
}

export function searchFiles(input: SearchFilesInput): string {
  const { pattern, path: searchPath = '.', type = 'text' } = input;

  if (!existsSync(searchPath)) return `Error: Path not found: ${searchPath}`;

  const MAX_OUTPUT = 4000;

  try {
    let result: string;

    if (type === 'glob') {
      // Use find for glob-style file matching
      result = execSync(`find ${JSON.stringify(searchPath)} -name ${JSON.stringify(pattern)} -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 15000,
      }).trim();
    } else {
      // Text search with grep
      result = execSync(
        `grep -r --include='*' -l ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} 2>/dev/null | grep -v node_modules | grep -v '.git'`,
        { encoding: 'utf-8', timeout: 15000 },
      ).trim();
    }

    if (!result) return `No matches found for "${pattern}" in ${searchPath}`;
    if (result.length > MAX_OUTPUT) {
      return result.slice(0, MAX_OUTPUT) + '\n... [output truncated]';
    }
    return result;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    // grep exits 1 when no matches found — that's not an error
    if (e.stdout !== undefined && !e.stdout.trim()) return `No matches found for "${pattern}" in ${searchPath}`;
    return `Error searching files: ${e.message ?? String(err)}`;
  }
}

export const searchFilesDefinition = {
  name: 'search_files',
  description: 'Search for files by name (glob) or content (text grep) within a directory',
  input_schema: {
    type: 'object' as const,
    properties: {
      pattern: { type: 'string', description: 'The filename glob or text pattern to search for' },
      path: { type: 'string', description: 'The root directory to search in (default: current directory)' },
      type: {
        type: 'string',
        enum: ['glob', 'text'],
        description: '"glob" to match filenames, "text" to grep file contents (default: text)',
      },
    },
    required: ['pattern'],
  },
};
