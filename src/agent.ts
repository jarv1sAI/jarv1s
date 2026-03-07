import Anthropic from '@anthropic-ai/sdk';
import * as readline from 'readline';
import { loadIdentity, type Identity } from './identity.js';
import {
  loadJarvisMd,
  getRecentMessages,
  saveMessage,
  getAllFacts,
  closeDb,
} from './memory.js';
import { TOOLS, executeTool } from './tools/index.js';

const MODEL = 'claude-sonnet-4-5-20250514';

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

function buildSystemPrompt(identity: Identity): string {
  const jarvisMd = loadJarvisMd();
  const now = new Date().toLocaleString();

  return `You are JARVIS, a local-first AI assistant.

## Identity
- ID: ${identity.id}
- Version: ${identity.version}
- Created: ${identity.created}
- Current time: ${now}

## Memory
${jarvisMd}

## Instructions
- Be concise and direct in your responses
- Use the \`remember\` tool proactively when the user shares something worth keeping (name, preferences, project context, etc.)
- Always ask before running potentially destructive bash commands
- Use \`recall\` to search your memory when you need to reference past information
- You have persistent memory across sessions - use it wisely
`;
}

function extractTextContent(content: ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('');
}

export async function runAgent(userInput?: string): Promise<void> {
  const client = new Anthropic();
  const identity = loadIdentity();
  const systemPrompt = buildSystemPrompt(identity);

  if (userInput) {
    await processUserInput(client, systemPrompt, userInput);
  } else {
    await runRepl(client, systemPrompt, identity);
  }

  closeDb();
}

async function processUserInput(
  client: Anthropic,
  systemPrompt: string,
  userInput: string
): Promise<void> {
  const history = getRecentMessages(20);
  const messages: Message[] = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  messages.push({ role: 'user', content: userInput });
  saveMessage('user', userInput);

  await runConversationLoop(client, systemPrompt, messages);
}

async function runConversationLoop(
  client: Anthropic,
  systemPrompt: string,
  messages: Message[]
): Promise<void> {
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS as Anthropic.Tool[],
      messages: messages as Anthropic.MessageParam[],
    });

    const hasToolUse = response.content.some(
      (block) => block.type === 'tool_use'
    );

    if (!hasToolUse) {
      const textContent = extractTextContent(
        response.content as ContentBlock[]
      );
      if (textContent) {
        process.stdout.write(textContent + '\n');
        saveMessage('assistant', textContent);
      }
      break;
    }

    const assistantContent = response.content as ContentBlock[];
    messages.push({ role: 'assistant', content: assistantContent });

    const toolResults: ContentBlock[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const toolUseBlock = block as {
          id: string;
          name: string;
          input: Record<string, unknown>;
        };
        const textBlocks = response.content.filter((b) => b.type === 'text');
        if (textBlocks.length > 0) {
          const textContent = textBlocks
            .map((b) => (b as { text: string }).text)
            .join('');
          if (textContent) {
            process.stdout.write(textContent + '\n');
          }
        }

        const result = await executeTool(
          toolUseBlock.name,
          toolUseBlock.input as unknown as Parameters<typeof executeTool>[1]
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseBlock.id,
          content: result,
        } as unknown as ContentBlock);
      }
    }

    messages.push({
      role: 'user',
      content: toolResults,
    });
  }
}

async function runRepl(
  client: Anthropic,
  systemPrompt: string,
  identity: Identity
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`JARVIS v${identity.version} | ID: ${identity.id.slice(0, 8)}`);
  console.log('Type /memory to see all facts, /clear to clear screen, /exit to quit.\n');

  const history = getRecentMessages(20);
  const messages: Message[] = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const prompt = (): void => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === '/exit') {
        console.log('Goodbye!');
        rl.close();
        return;
      }

      if (trimmed === '/clear') {
        console.clear();
        prompt();
        return;
      }

      if (trimmed === '/memory') {
        const facts = getAllFacts();
        if (facts.length === 0) {
          console.log('No facts stored yet.\n');
        } else {
          console.log('Stored memories:');
          facts.forEach((f) => {
            console.log(`  - ${f.key}: ${f.value}`);
          });
          console.log();
        }
        prompt();
        return;
      }

      messages.push({ role: 'user', content: trimmed });
      saveMessage('user', trimmed);

      try {
        await runConversationLoop(client, systemPrompt, messages);
      } catch (error: unknown) {
        const err = error as { message?: string };
        console.error(`Error: ${err.message || 'Unknown error'}\n`);
      }

      console.log();
      prompt();
    });
  };

  prompt();
}
