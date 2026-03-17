/**
 * Sanitization helpers for untrusted content imported via bundles or peer sync.
 * Applied to JARVIS.md appends and fact values before they reach SQLite / the system prompt.
 */

const MAX_MEMORY_BYTES = 64 * 1024;   // 64 KB per imported JARVIS.md block
const MAX_FACT_BYTES   = 2 * 1024;    // 2 KB per fact value

/**
 * Known prompt-injection patterns. These are stripped (replaced with [REDACTED])
 * from any content that will end up in the system prompt via JARVIS.md.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /new\s+system\s+prompt\s*:/gi,
  /you\s+are\s+now\s+(?!JARVIS)/gi,        // "you are now X" — allow "you are now JARVIS"
  /your\s+new\s+(primary\s+)?directive/gi,
  /<\s*system\s*>/gi,                       // XML-style system tag injection
  /\[\s*system\s*\]/gi,                     // bracket-style system tag injection
];

/**
 * Sanitize a JARVIS.md block imported from a bundle or peer sync.
 * - Enforces max length
 * - Strips HTML tags
 * - Redacts known prompt-injection phrases
 */
export function sanitizeMemoryContent(content: string): string {
  let safe = content.slice(0, MAX_MEMORY_BYTES);

  // Strip HTML tags (shouldn't appear in markdown, but belt-and-suspenders)
  safe = safe.replace(/<[^>]{0,200}>/g, '');

  // Redact injection attempts
  for (const pattern of INJECTION_PATTERNS) {
    safe = safe.replace(pattern, '[REDACTED]');
  }

  return safe;
}

/**
 * Sanitize a single fact value imported from a bundle or peer sync.
 * - Enforces max length
 * - Strips HTML tags
 */
export function sanitizeFactValue(value: string): string {
  let safe = value.slice(0, MAX_FACT_BYTES);
  safe = safe.replace(/<[^>]{0,200}>/g, '');
  return safe;
}
