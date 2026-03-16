import { readFileSync, writeFileSync, existsSync } from 'fs';
import { checkPathAllowed } from './pathguard.js';
import { type ConfirmationBroker, defaultBroker } from './confirmation.js';

const MAX_FILE_LENGTH = 8000;

// Injected at startup via initToolConfig() in tools/index.ts
let _allowedPaths: string[] | undefined;
export function setFilesAllowedPaths(paths: string[] | undefined): void {
  _allowedPaths = paths;
}

let _broker: ConfirmationBroker = defaultBroker();
export function setFilesBroker(broker: ConfirmationBroker): void {
  _broker = broker;
}

export interface ReadFileInput {
  path: string;
}

export interface WriteFileInput {
  path: string;
  content: string;
}

export function readFile(input: ReadFileInput): string {
  const { path } = input;

  const guard = checkPathAllowed(path, _allowedPaths);
  if (guard) return guard;

  try {
    if (!existsSync(path)) {
      return `Error: File not found: ${path}`;
    }

    const content = readFileSync(path, 'utf-8');
    if (content.length > MAX_FILE_LENGTH) {
      return content.slice(0, MAX_FILE_LENGTH) + '\n... [content truncated]';
    }
    return content;
  } catch (error: unknown) {
    const err = error as { message?: string };
    return `Error reading file: ${err.message || 'Unknown error'}`;
  }
}

export async function writeFile(input: WriteFileInput): Promise<string> {
  const { path, content } = input;

  const guard = checkPathAllowed(path, _allowedPaths);
  if (guard) return guard;

  try {
    if (existsSync(path)) {
      const approved = await _broker.ask(`[JARVIS] File exists: ${path}. Overwrite? (y/n) `);
      if (!approved) {
        return 'Write operation cancelled by user.';
      }
    }

    writeFileSync(path, content, 'utf-8');
    return `Successfully wrote ${content.length} bytes to ${path}`;
  } catch (error: unknown) {
    const err = error as { message?: string };
    return `Error writing file: ${err.message || 'Unknown error'}`;
  }
}

export const readFileDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file at the given path',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read',
      },
    },
    required: ['path'],
  },
};

export const writeFileDefinition = {
  name: 'write_file',
  description: 'Write content to a file at the given path',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
};
