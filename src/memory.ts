import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getJarvisDir } from './identity.js';

const DB_FILE = join(getJarvisDir(), 'memory.db');
const JARVIS_MD_FILE = join(getJarvisDir(), 'JARVIS.md');

const DEFAULT_JARVIS_MD = `# JARVIS Memory

## Identity
I am JARVIS — a local-first AI assistant. I maintain persistent memory across sessions and can execute tools on the host system.

## Preferences
- Be concise and direct
- Ask before running destructive commands
- Remember important context the user shares
`;

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_FILE);
    db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_facts_key ON facts(key);
    `);
  }
  return db;
}

export interface Message {
  role: string;
  content: string;
}

export interface Fact {
  id: number;
  key: string;
  value: string;
  created_at: string;
}

export function saveMessage(role: string, content: string): void {
  const database = getDb();
  const stmt = database.prepare(
    'INSERT INTO conversations (role, content, timestamp) VALUES (?, ?, ?)'
  );
  stmt.run(role, content, new Date().toISOString());
}

export function getRecentMessages(n: number): Message[] {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT role, content FROM conversations ORDER BY id DESC LIMIT ?'
  );
  const rows = stmt.all(n) as Message[];
  return rows.reverse();
}

export function saveFact(key: string, value: string): void {
  const database = getDb();
  const existing = database
    .prepare('SELECT id FROM facts WHERE key = ?')
    .get(key) as { id: number } | undefined;

  if (existing) {
    database
      .prepare('UPDATE facts SET value = ?, created_at = ? WHERE id = ?')
      .run(value, new Date().toISOString(), existing.id);
  } else {
    database
      .prepare('INSERT INTO facts (key, value, created_at) VALUES (?, ?, ?)')
      .run(key, value, new Date().toISOString());
  }
}

export function searchFacts(query: string): Fact[] {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT id, key, value, created_at FROM facts WHERE key LIKE ? OR value LIKE ?'
  );
  const pattern = `%${query}%`;
  return stmt.all(pattern, pattern) as Fact[];
}

export function getAllFacts(): Fact[] {
  const database = getDb();
  const stmt = database.prepare(
    'SELECT id, key, value, created_at FROM facts ORDER BY created_at DESC'
  );
  return stmt.all() as Fact[];
}

export function loadJarvisMd(): string {
  if (!existsSync(JARVIS_MD_FILE)) {
    writeFileSync(JARVIS_MD_FILE, DEFAULT_JARVIS_MD);
    return DEFAULT_JARVIS_MD;
  }
  return readFileSync(JARVIS_MD_FILE, 'utf-8');
}

export function appendToJarvisMd(content: string): void {
  if (!existsSync(JARVIS_MD_FILE)) {
    writeFileSync(JARVIS_MD_FILE, DEFAULT_JARVIS_MD);
  }
  appendFileSync(JARVIS_MD_FILE, '\n' + content);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
