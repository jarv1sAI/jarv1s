#!/usr/bin/env node

import { runAgent } from './agent.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    const userInput = args.join(' ');
    await runAgent(userInput);
  } else {
    await runAgent();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error.message || error);
  process.exit(1);
});
