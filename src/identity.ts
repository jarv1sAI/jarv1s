import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Identity {
  id: string;
  created: string;
  version: string;
}

const JARVIS_DIR = join(homedir(), '.jarvis');
const IDENTITY_FILE = join(JARVIS_DIR, 'identity.json');

function ensureJarvisDir(): void {
  if (!existsSync(JARVIS_DIR)) {
    mkdirSync(JARVIS_DIR, { recursive: true });
  }
}

export function loadIdentity(): Identity {
  ensureJarvisDir();

  if (existsSync(IDENTITY_FILE)) {
    const data = readFileSync(IDENTITY_FILE, 'utf-8');
    return JSON.parse(data) as Identity;
  }

  const identity: Identity = {
    id: randomUUID(),
    created: new Date().toISOString(),
    version: '1.0.0',
  };

  writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
  return identity;
}

export function getJarvisDir(): string {
  ensureJarvisDir();
  return JARVIS_DIR;
}
