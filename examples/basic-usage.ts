/**
 * Basic usage example for infinite-memory
 * 
 * This example demonstrates:
 * - Setting up infinite memory
 * - Creating a model with conversation context
 * - Sending a simple message
 */

import { createInfiniteMemory } from '../src/index.js';
import { generateText } from 'ai';

async function main() {
  // Create infinite memory provider
  const memory = createInfiniteMemory({
    openMemoryUrl: process.env.OPENMEMORY_URL || 'http://localhost:8080',
    openMemoryApiKey: process.env.OPENMEMORY_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  });

  console.log('🚀 Infinite Memory Example - Basic Usage\n');

  // Create a model for this conversation
  const conversationId = `example_${Date.now()}`;
  const userId = 'demo_user';

  const model = memory('claude-sonnet-4', {
    conversationId,
    userId,
  });

  console.log(`📝 Conversation ID: ${conversationId}`);
  console.log(`👤 User ID: ${userId}\n`);

  // Send first message
  console.log('Sending first message...\n');
  const result1 = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: 'My favorite color is blue and I love hiking in the mountains.',
      },
    ],
  });

  console.log('Assistant:', result1.text);
  console.log('\n---\n');

  // Send second message - model should remember context
  console.log('Sending second message (testing memory)...\n');
  const result2 = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: 'My favorite color is blue and I love hiking in the mountains.',
      },
      {
        role: 'assistant',
        content: result1.text,
      },
      {
        role: 'user',
        content: 'What did I just tell you about my preferences?',
      },
    ],
  });

  console.log('Assistant:', result2.text);
  console.log('\n✅ Done! Messages are stored in OpenMemory for infinite recall.');
}

main().catch(console.error);

