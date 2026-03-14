/**
 * jarvis doctor — system health check
 */

import { existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { getMemoryDir, DIRS, loadIdentity } from './identity.js';
import { loadConfig, getConfigPath } from './config.js';
import { getAllFacts, getSessionIds, closeDb } from './memory.js';

interface Check {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail?: string;
}

function checkNodeVersion(): Check {
  const v = process.version;
  const major = parseInt(v.slice(1).split('.')[0], 10);
  if (major < 20) return { label: 'Node.js', status: 'fail', detail: `${v} — requires >=20` };
  return { label: 'Node.js', status: 'ok', detail: v };
}

function checkConfig(): Check {
  const path = getConfigPath();
  if (!existsSync(path)) return { label: 'Config (jarvis.yaml)', status: 'warn', detail: 'Not found (will be created on first run)' };
  try {
    const config = loadConfig();
    return { label: 'Config (jarvis.yaml)', status: 'ok', detail: `provider: ${config.provider} · model: ${config.model}` };
  } catch (e: unknown) {
    return { label: 'Config (jarvis.yaml)', status: 'fail', detail: (e as { message?: string }).message };
  }
}

// Providers that need no API key (local-only)
const LOCAL_PROVIDERS = new Set(['ollama', 'subprocess']);

function checkApiKey(): Check {
  const config = loadConfig();
  const provider = config.provider;

  if (LOCAL_PROVIDERS.has(provider)) {
    return { label: 'API Key', status: 'ok', detail: `Not required for "${provider}"` };
  }

  const key = config.api_key ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.CLAUDE_LOCAL_API_KEY ??
    process.env.JARVIS_API_KEY;
  if (!key) return { label: 'API Key', status: 'fail', detail: `Not set for provider "${provider}"` };

  const preview = key.length > 8 ? `${key.slice(0, 8)}...${key.slice(-4)}` : '(set)';
  return { label: 'API Key', status: 'ok', detail: preview };
}

function checkProvider(): Check {
  const config = loadConfig();
  const { provider, model, base_url } = config;

  if (provider === 'subprocess') {
    const cmd = config.subprocess_cmd;
    if (!cmd) {
      return { label: 'Provider (subprocess)', status: 'warn', detail: 'subprocess_cmd not set in jarvis.yaml' };
    }
    try {
      execSync(`command -v ${cmd.split(' ')[0]}`, { stdio: 'pipe' });
      return { label: 'Provider (subprocess)', status: 'ok', detail: `cmd: ${cmd}` };
    } catch {
      return { label: 'Provider (subprocess)', status: 'warn', detail: `command not found: ${cmd.split(' ')[0]}` };
    }
  }

  if (provider === 'ollama') {
    const probeUrl = (base_url ?? 'http://localhost:11434/v1').replace('/v1', '/api/tags');
    try {
      execSync(`curl -sf ${probeUrl} -o /dev/null`, { timeout: 3000, stdio: 'pipe' });
      return { label: 'Provider (ollama)', status: 'ok', detail: `Reachable at ${base_url ?? 'http://localhost:11434'} · model: ${model}` };
    } catch {
      return { label: 'Provider (ollama)', status: 'warn', detail: `Not reachable at ${probeUrl} — is Ollama running?` };
    }
  }

  return { label: `Provider (${provider})`, status: 'ok', detail: `model: ${model}` };
}

function checkIdentity(): Check {
  try {
    const id = loadIdentity();
    return { label: 'Identity', status: 'ok', detail: `${id.id.slice(0, 24)} (v${id.version})` };
  } catch (e: unknown) {
    return { label: 'Identity', status: 'fail', detail: (e as { message?: string }).message };
  }
}

function checkDirectories(): Check {
  const missing: string[] = [];
  for (const [name, dir] of Object.entries(DIRS)) {
    if (!existsSync(dir)) missing.push(name);
  }
  if (missing.length > 0) return { label: 'Directories', status: 'warn', detail: `Missing: ${missing.join(', ')}` };
  return { label: 'Directories', status: 'ok', detail: '~/.jarvis/ layout OK' };
}

function checkDb(): Check {
  const dbPath = join(getMemoryDir(), 'interactions.db');
  if (!existsSync(dbPath)) return { label: 'Database', status: 'warn', detail: 'Not created yet (first use)' };
  try {
    const facts = getAllFacts().length;
    const sessions = getSessionIds().length;
    const kb = (statSync(dbPath).size / 1024).toFixed(1);
    return { label: 'Database', status: 'ok', detail: `${facts} facts · ${sessions} sessions · ${kb} KB` };
  } catch (e: unknown) {
    return { label: 'Database', status: 'fail', detail: (e as { message?: string }).message };
  }
}

function checkJarvisMd(): Check {
  const path = join(getMemoryDir(), 'JARVIS.md');
  if (!existsSync(path)) return { label: 'JARVIS.md', status: 'warn', detail: 'Not found (first use)' };
  return { label: 'JARVIS.md', status: 'ok', detail: `${(statSync(path).size / 1024).toFixed(1)} KB` };
}

function checkCommand(cmd: string, label: string): Check {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe' });
    return { label, status: 'ok' };
  } catch {
    return { label, status: 'warn', detail: 'Not found in PATH' };
  }
}

// ---------------------------------------------------------------------------

const ICONS = { ok: '✓', warn: '!', fail: '✗' };
const COLORS = { ok: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m' };
const RESET = '\x1b[0m';

export function runDoctor(): void {
  console.log('\nJARVIS Doctor\n' + '─'.repeat(52));

  const checks: Check[] = [
    checkNodeVersion(),
    checkConfig(),
    checkApiKey(),
    checkProvider(),
    checkIdentity(),
    checkDirectories(),
    checkDb(),
    checkJarvisMd(),
    checkCommand('git', 'git'),
    checkCommand('grep', 'grep'),
    checkCommand('curl', 'curl'),
  ];

  let hasIssue = false;
  for (const c of checks) {
    const color = COLORS[c.status];
    const icon = ICONS[c.status];
    const detail = c.detail ? `  ${c.detail}` : '';
    console.log(`  ${color}${icon}${RESET} ${c.label.padEnd(30)}${detail}`);
    if (c.status !== 'ok') hasIssue = true;
  }

  console.log('─'.repeat(52));
  if (!hasIssue) {
    console.log(`${COLORS.ok}All checks passed.${RESET}\n`);
  } else {
    console.log(`${COLORS.warn}Some checks need attention.${RESET}\n`);
  }

  closeDb();
}
