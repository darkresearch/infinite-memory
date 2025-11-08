/**
 * Streaming example for infinite-memory
 * 
 * This example demonstrates:
 * - Streaming responses with infinite memory
 * - Building up a conversation over time
 * - Automatic context retrieval
 */

import { createInfiniteMemory } from '../src/index.js';
import { streamText } from 'ai';

async function main() {
  // Create infinite memory provider
  const memory = createInfiniteMemory({
    openMemoryUrl: process.env.OPENMEMORY_URL || 'http://localhost:8080',
    openMemoryApiKey: process.env.OPENMEMORY_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  });

  console.log('🚀 Infinite Memory Example - Streaming\n');

  const conversationId = `stream_example_${Date.now()}`;
  const userId = 'demo_user';

  const model = memory('claude-sonnet-4', {
    conversationId,
    userId,
  });

  console.log(`📝 Conversation ID: ${conversationId}`);
  console.log(`👤 User ID: ${userId}\n`);

  // Helper to stream a message
  async function chat(userMessage: string, existingMessages: any[] = []) {
    console.log(`\n👤 User: ${userMessage}\n`);
    console.log('🤖 Assistant: ');

    const result = await streamText({
      model,
      messages: [
        ...existingMessages,
        { role: 'user', content: userMessage },
      ],
    });

    let fullResponse = '';
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk);
      fullResponse += chunk;
    }

    console.log('\n');
    return fullResponse;
  }

  // Simulate a conversation
  const messages: any[] = [];

  // Message 1
  const response1 = await chat(
    'I work as a software engineer and I love building AI applications.'
  );
  messages.push(
    { role: 'user', content: 'I work as a software engineer and I love building AI applications.' },
    { role: 'assistant', content: response1 }
  );

  // Message 2
  const response2 = await chat(
    'I also enjoy rock climbing on weekends.',
    messages
  );
  messages.push(
    { role: 'user', content: 'I also enjoy rock climbing on weekends.' },
    { role: 'assistant', content: response2 }
  );

  // Message 3 - Reference earlier context
  const response3 = await chat(
    'Can you suggest a weekend project that combines my profession and hobbies?',
    messages
  );
  messages.push(
    { role: 'user', content: 'Can you suggest a weekend project that combines my profession and hobbies?' },
    { role: 'assistant', content: response3 }
  );

  console.log('---');
  console.log('✅ Done! The model remembered your profession (software engineering) and hobbies (AI, rock climbing)');
  console.log('📦 All messages are stored in OpenMemory for future retrieval');
}

main().catch(console.error);

