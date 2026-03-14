const MAX_CONTENT = 8000;

export interface WebFetchInput {
  url: string;
  selector?: string;
}

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
