import { saveFact, searchFacts, type Fact } from '../memory.js';

export interface RememberInput {
  key: string;
  value: string;
}

export interface RecallInput {
  query: string;
}

export function remember(input: RememberInput): string {
  const { key, value } = input;
  saveFact(key, value);
  return `Remembered: "${key}" = "${value}"`;
}

export function recall(input: RecallInput): string {
  const { query } = input;
  const facts: Fact[] = searchFacts(query);

  if (facts.length === 0) {
    return `No memories found matching "${query}"`;
  }

  const formatted = facts
    .map((f) => `- ${f.key}: ${f.value}`)
    .join('\n');

  return `Found ${facts.length} memory/memories:\n${formatted}`;
}

export const rememberDefinition = {
  name: 'remember',
  description:
    'Store a fact in persistent memory. Use this proactively when the user shares something worth retaining (name, preference, project context, etc.)',
  input_schema: {
    type: 'object' as const,
    properties: {
      key: {
        type: 'string',
        description: 'A short key or label for this memory',
      },
      value: {
        type: 'string',
        description: 'The value or content to remember',
      },
    },
    required: ['key', 'value'],
  },
};

export const recallDefinition = {
  name: 'recall',
  description: 'Search persistent memory for facts matching a query',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find matching memories',
      },
    },
    required: ['query'],
  },
};
