import { execSync } from 'child_process';
import { platform } from 'os';

const MAX_LENGTH = 4000;

export interface ClipboardReadInput {
  // no params needed
}

export interface ClipboardWriteInput {
  content: string;
}

function getReadCmd(): string | null {
  const p = platform();
  if (p === 'darwin') return 'pbpaste';
  if (p === 'linux') {
    // try xclip then xsel then wl-paste (Wayland)
    for (const cmd of ['xclip -selection clipboard -o', 'xsel --clipboard --output', 'wl-paste']) {
      try { execSync(`command -v ${cmd.split(' ')[0]}`, { stdio: 'pipe' }); return cmd; } catch { /* skip */ }
    }
  }
  if (p === 'win32') return 'powershell.exe -command "Get-Clipboard"';
  return null;
}

function getWriteCmd(content: string): string | null {
  const p = platform();
  const escaped = content.replace(/'/g, "'\\''");
  if (p === 'darwin') return `echo '${escaped}' | pbcopy`;
  if (p === 'linux') {
    for (const [check, cmd] of [
      ['xclip', `echo '${escaped}' | xclip -selection clipboard`],
      ['xsel', `echo '${escaped}' | xsel --clipboard --input`],
      ['wl-copy', `echo '${escaped}' | wl-copy`],
    ]) {
      try { execSync(`command -v ${check}`, { stdio: 'pipe' }); return cmd as string; } catch { /* skip */ }
    }
  }
  if (p === 'win32') return `powershell.exe -command "Set-Clipboard '${escaped}'"`;
  return null;
}

export function clipboardRead(_input: ClipboardReadInput): string {
  const cmd = getReadCmd();
  if (!cmd) return 'Error: Clipboard not supported on this platform';
  try {
    const text = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
    if (!text) return '(clipboard is empty)';
    if (text.length > MAX_LENGTH) return text.slice(0, MAX_LENGTH) + '\n... [truncated]';
    return text;
  } catch (err: unknown) {
    return `Error reading clipboard: ${(err as { message?: string }).message ?? String(err)}`;
  }
}

export async function clipboardWrite(input: ClipboardWriteInput): Promise<string> {
  const { content } = input;
  const cmd = getWriteCmd(content);
  if (!cmd) return 'Error: Clipboard not supported on this platform';
  try {
    execSync(cmd, { timeout: 5000 });
    return `Copied ${content.length} characters to clipboard.`;
  } catch (err: unknown) {
    return `Error writing to clipboard: ${(err as { message?: string }).message ?? String(err)}`;
  }
}

export const clipboardReadDefinition = {
  name: 'clipboard_read',
  description: 'Read the current contents of the system clipboard',
  input_schema: { type: 'object' as const, properties: {}, required: [] },
};

export const clipboardWriteDefinition = {
  name: 'clipboard_write',
  description: 'Write text content to the system clipboard',
  input_schema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'The text to copy to clipboard' },
    },
    required: ['content'],
  },
};
