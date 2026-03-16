/**
 * web_search tool — queries a local SearXNG instance and returns structured results.
 *
 * Requires searxng_url to be set in jarvis.yaml.
 * Each result includes: title, url, snippet (content).
 */

import { loadConfig } from '../config.js';
import { isPrivateAddress } from './web.js';

export interface WebSearchInput {
  query: string;
  /** Number of results to return (default 5, max 10). */
  num_results?: number;
}

interface SearXNGResult {
  title?: string;
  url?: string;
  content?: string;
}

interface SearXNGResponse {
  results?: SearXNGResult[];
}

export async function webSearch(input: WebSearchInput): Promise<string> {
  const { query, num_results = 5 } = input;
  if (!query?.trim()) return 'Error: query is required';

  const config = loadConfig();
  if (!config.searxng_url) {
    return 'Error: searxng_url is not configured in jarvis.yaml. Add searxng_url: http://localhost:8888 to enable web_search.';
  }

  let parsed: URL;
  try {
    parsed = new URL(config.searxng_url);
  } catch {
    return `Error: searxng_url is not a valid URL: ${config.searxng_url}`;
  }

  // SSRF guard — SearXNG must be on localhost
  if (await isPrivateAddress(parsed.hostname)) {
    // Private/loopback is required here — this is intentional (local SearXNG only)
  } else {
    return 'Error: searxng_url must point to a local SearXNG instance (localhost / private network).';
  }

  const limit = Math.min(Math.max(1, num_results), 10);
  const searchUrl = new URL('/search', parsed.origin);
  searchUrl.searchParams.set('q', query.trim());
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('categories', 'general');

  try {
    const res = await fetch(searchUrl.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return `Error: SearXNG returned HTTP ${res.status}`;

    const data = (await res.json()) as SearXNGResponse;
    const results = (data.results ?? []).slice(0, limit);

    if (!results.length) return `No results found for: ${query}`;

    return results
      .map((r, i) =>
        `[${i + 1}] ${r.title ?? '(no title)'}\n    URL: ${r.url ?? '(no url)'}\n    ${r.content ?? '(no snippet)'}`,
      )
      .join('\n\n');
  } catch (err: unknown) {
    const e = err as { message?: string };
    return `Error querying SearXNG: ${e.message ?? 'Unknown error'}`;
  }
}

export const webSearchDefinition = {
  name: 'web_search',
  description: 'Search the web using a local SearXNG instance. Returns titles, URLs, and snippets.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return (default 5, max 10)',
      },
    },
    required: ['query'],
  },
};
