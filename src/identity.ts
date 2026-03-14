import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Identity {
  id: string;
  created: string;
  version: string;
}

const JARVIS_ROOT = join(homedir(), '.jarvis');

// Per ARCHITECTURE.MD directory layout
export const DIRS = {
  root: JARVIS_ROOT,
  identity: join(JARVIS_ROOT, 'identity'),
  memory: join(JARVIS_ROOT, 'memory'),
  state: join(JARVIS_ROOT, 'state'),
  stateSession: join(JARVIS_ROOT, 'state', 'session'),
  stateCheckpoints: join(JARVIS_ROOT, 'state', 'checkpoints'),
  config: join(JARVIS_ROOT, 'config'),
};

const IDENTITY_FILE = join(DIRS.identity, 'jarvis.id');

function migrateOldLayout(): void {
  const oldIdentityFile = join(JARVIS_ROOT, 'identity.json');
  const oldMemoryDb = join(JARVIS_ROOT, 'memory.db');
  const oldJarvisMd = join(JARVIS_ROOT, 'JARVIS.md');

  if (existsSync(oldIdentityFile) && !existsSync(IDENTITY_FILE)) {
    const data = JSON.parse(readFileSync(oldIdentityFile, 'utf-8')) as Identity;
    writeFileSync(IDENTITY_FILE, JSON.stringify(data, null, 2));
  }

  const newDb = join(DIRS.memory, 'interactions.db');
  if (existsSync(oldMemoryDb) && !existsSync(newDb)) {
    copyFileSync(oldMemoryDb, newDb);
  }

  const newMd = join(DIRS.memory, 'JARVIS.md');
  if (existsSync(oldJarvisMd) && !existsSync(newMd)) {
    copyFileSync(oldJarvisMd, newMd);
  }
}

export function ensureDirectories(): void {
  for (const dir of Object.values(DIRS)) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  migrateOldLayout();
}

export function loadIdentity(): Identity {
  ensureDirectories();

  if (existsSync(IDENTITY_FILE)) {
    const data = readFileSync(IDENTITY_FILE, 'utf-8');
    return JSON.parse(data) as Identity;
  }

  const identity: Identity = {
    id: `jarvis-${randomUUID()}`,
    created: new Date().toISOString(),
    version: '2.0.0',
  };

  writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
  return identity;
}

// Convenience accessors
export function getJarvisDir(): string {
  ensureDirectories();
  return DIRS.root;
}

export function getMemoryDir(): string {
  ensureDirectories();
  return DIRS.memory;
}

export function getStateSessionDir(): string {
  ensureDirectories();
  return DIRS.stateSession;
}

export function getCheckpointsDir(): string {
  ensureDirectories();
  return DIRS.stateCheckpoints;
}

export function getConfigDir(): string {
  ensureDirectories();
  return DIRS.config;
}
