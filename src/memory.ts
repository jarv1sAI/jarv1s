import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getMemoryDir, getStateSessionDir } from './identity.js';

const DEFAULT_JARVIS_MD = `# JARVIS Memory

## Identity
I am JARVIS — a local-first AI assistant. I maintain persistent memory across sessions and can execute tools on the host system.

## Preferences
- Be concise and direct
- Ask before running destructive commands
- Remember important context the user shares
`;

let db: Database.Database | null = null;

function getDbPath(): string {
  return join(getMemoryDir(), 'interactions.db');
}

function getJarvisMdPath(): string {
  return join(getMemoryDir(), 'JARVIS.md');
}

function getDb(): Database.Database {
  if (!db) {
    db = new Database(getDbPath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        input TEXT NOT NULL,
        result TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_facts_key ON facts(key);
      CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
      CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(timestamp);
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        summary TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
    `);
  }
  return db;
}

export interface Message {
  role: string;
  content: string;
  session_id?: string;
  timestamp?: string;
}

export interface Fact {
  id: number;
  key: string;
  value: string;
  created_at: string;
}

// --- Session management ---

let currentSessionId: string | null = null;

export function getOrCreateSession(): string {
  if (currentSessionId) return currentSessionId;

  const sessionFile = join(getStateSessionDir(), 'current.json');
  const sessionId = new Date().toISOString().replace(/[:.]/g, '-');

  currentSessionId = sessionId;
  writeFileSync(sessionFile, JSON.stringify({ session_id: sessionId, started: new Date().toISOString() }, null, 2));
  return sessionId;
}

// --- Conversations ---

export function saveMessage(role: string, content: string): void {
  const database = getDb();
  const sessionId = getOrCreateSession();
  database
    .prepare('INSERT INTO conversations (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
    .run(sessionId, role, content, new Date().toISOString());
}

export function getRecentMessages(n: number): Message[] {
  const database = getDb();
  const sessionId = getOrCreateSession();
  const rows = database
    .prepare('SELECT role, content FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .all(sessionId, n) as Message[];
  return rows.reverse();
}

export function getAllMessages(limit = 100): Message[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT session_id, role, content, timestamp FROM conversations ORDER BY id DESC LIMIT ?')
    .all(limit) as Message[];
  return rows.reverse();
}

export function getSessionIds(): string[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT DISTINCT session_id FROM conversations ORDER BY session_id DESC')
    .all() as { session_id: string }[];
  return rows.map((r) => r.session_id);
}

// --- Audit log ---

export interface AuditEntry {
  id: number;
  session_id: string;
  tool: string;
  input: string;
  result: string;
  duration_ms: number;
  timestamp: string;
}

export function logToolCall(tool: string, input: unknown, result: string, durationMs: number): void {
  const database = getDb();
  const sessionId = getOrCreateSession();
  const inputJson = JSON.stringify(input);
  // Truncate result to 2 KB to avoid unbounded growth
  const resultTrunc = result.length > 2048 ? result.slice(0, 2048) + '…' : result;
  database
    .prepare('INSERT INTO audit_log (session_id, tool, input, result, duration_ms, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sessionId, tool, inputJson, resultTrunc, durationMs, new Date().toISOString());
}

export function getAuditLog(limit = 200): AuditEntry[] {
  const database = getDb();
  return database
    .prepare('SELECT id, session_id, tool, input, result, duration_ms, timestamp FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(limit) as AuditEntry[];
}

// --- Session summaries ---

export interface SessionSummary {
  id: number;
  session_id: string;
  summary: string;
  message_count: number;
  created_at: string;
}

/** Threshold: auto-summarize when a session reaches this many messages. */
export const SUMMARY_THRESHOLD = 40;

export function getSessionSummary(sessionId: string): SessionSummary | null {
  const database = getDb();
  return (database
    .prepare('SELECT id, session_id, summary, message_count, created_at FROM summaries WHERE session_id = ?')
    .get(sessionId) as SessionSummary | undefined) ?? null;
}

export function saveSessionSummary(sessionId: string, summary: string, messageCount: number): void {
  const database = getDb();
  database
    .prepare(`
      INSERT INTO summaries (session_id, summary, message_count, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        summary = excluded.summary,
        message_count = excluded.message_count,
        created_at = excluded.created_at
    `)
    .run(sessionId, summary, messageCount, new Date().toISOString());
}

export function getSessionMessageCount(sessionId: string): number {
  const database = getDb();
  const row = database
    .prepare('SELECT COUNT(*) as cnt FROM conversations WHERE session_id = ?')
    .get(sessionId) as { cnt: number };
  return row.cnt;
}

// --- Facts ---

export function saveFact(key: string, value: string): void {
  const database = getDb();
  const existing = database.prepare('SELECT id FROM facts WHERE key = ?').get(key) as { id: number } | undefined;

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

export function deleteFact(key: string): boolean {
  const database = getDb();
  const result = database.prepare('DELETE FROM facts WHERE key = ?').run(key);
  return result.changes > 0;
}

export function searchFacts(query: string): Fact[] {
  const database = getDb();
  const pattern = `%${query}%`;
  return database
    .prepare('SELECT id, key, value, created_at FROM facts WHERE key LIKE ? OR value LIKE ?')
    .all(pattern, pattern) as Fact[];
}

export function getAllFacts(): Fact[] {
  const database = getDb();
  return database
    .prepare('SELECT id, key, value, created_at FROM facts ORDER BY created_at DESC')
    .all() as Fact[];
}

// --- JARVIS.md ---

export function loadJarvisMd(): string {
  const path = getJarvisMdPath();
  if (!existsSync(path)) {
    writeFileSync(path, DEFAULT_JARVIS_MD);
    return DEFAULT_JARVIS_MD;
  }
  return readFileSync(path, 'utf-8');
}

export function appendToJarvisMd(content: string): void {
  const path = getJarvisMdPath();
  if (!existsSync(path)) {
    writeFileSync(path, DEFAULT_JARVIS_MD);
  }
  const existing = readFileSync(path, 'utf-8');
  writeFileSync(path, existing + '\n' + content);
}

// --- Lifecycle ---

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
