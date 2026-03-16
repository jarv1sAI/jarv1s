import { promises as dns } from 'dns';

const MAX_CONTENT = 8000;

export interface WebFetchInput {
  url: string;
  selector?: string;
}

// ---------------------------------------------------------------------------
// SSRF protection — block private / link-local / loopback IP ranges
// ---------------------------------------------------------------------------

const PRIVATE_RANGES: RegExp[] = [
  /^127\./,                        // loopback IPv4
  /^0\./,                          // "this" network
  /^10\./,                         // RFC 1918 class A
  /^172\.(1[6-9]|2\d|3[01])\./,   // RFC 1918 class B
  /^192\.168\./,                   // RFC 1918 class C
  /^169\.254\./,                   // link-local / cloud IMDS
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT RFC 6598
  /^::1$/,                         // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,              // IPv6 ULA
  /^fe80:/i,                       // IPv6 link-local
  /^fd[0-9a-f]{2}:/i,              // IPv6 ULA
];

async function isPrivateAddress(hostname: string): Promise<boolean> {
  // Reject bare IP literals that match private ranges without DNS lookup
  for (const re of PRIVATE_RANGES) {
    if (re.test(hostname)) return true;
  }

  try {
    const result = await dns.lookup(hostname, { all: true });
    for (const { address } of result) {
      for (const re of PRIVATE_RANGES) {
        if (re.test(address)) return true;
      }
    }
  } catch {
    // DNS failure — block rather than allow
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function webFetch(input: WebFetchInput): Promise<string> {
  const { url } = input;

  // Basic URL validation
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Error: Invalid URL: ${url}`;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `Error: Only http/https URLs are supported`;
  }

  // SSRF protection — resolve hostname and block private addresses
  if (await isPrivateAddress(parsed.hostname)) {
    return `Error: Requests to private, loopback, or link-local addresses are not allowed`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'JARVIS/2.0 (local AI assistant)' },
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      return `Error: HTTP ${resp.status} ${resp.statusText}`;
    }

    const contentType = resp.headers.get('content-type') ?? '';
    const rawText = await resp.text();

    let content: string;
    if (contentType.includes('text/html')) {
      content = stripHtml(rawText);
    } else {
      content = rawText;
    }

    if (content.length > MAX_CONTENT) {
      return content.slice(0, MAX_CONTENT) + '\n... [content truncated]';
    }
    return content || '(empty response)';
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    if (e.name === 'AbortError') return `Error: Request timed out after 15 seconds`;
    return `Error fetching URL: ${e.message ?? String(err)}`;
  }
}

export const webFetchDefinition = {
  name: 'web_fetch',
  description: 'Fetch and return the text content of a web page or URL',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
    },
    required: ['url'],
  },
};

// Export SSRF checker so browser tool and peer handoff can reuse it
export { isPrivateAddress };
