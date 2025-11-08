# infinite-memory

> Infinite context windows for Claude via OpenMemory semantic retrieval

**By [Dark Research](https://github.com/darkresearch)**

Drop-in replacement for Anthropic's AI SDK provider that automatically manages infinite conversation context using OpenMemory for semantic storage and retrieval.

## Features

- 🎯 **Truly infinite context** - Never lose conversation history, no matter how long
- 🧠 **Smart retrieval** - Semantic search finds relevant context from thousands of messages
- 🔄 **Transparent operation** - Drop-in replacement for `@ai-sdk/anthropic`
- ⚡ **Token-aware** - Automatically fits context under model limits (200k for Sonnet 4)
- 💾 **Automatic storage** - Messages stored in OpenMemory with zero configuration
- 🛡️ **Resilient** - Falls back to recent messages if OpenMemory is unavailable
- 🔧 **Zero config** - Just provide `conversationId` and `userId`

## Installation

```bash
npm install infinite-memory
```

## Prerequisites

You need an OpenMemory server running. See [OpenMemory Quick Start](https://openmemory.cavira.app/docs/quick-start) for setup.

## Quick Start

```typescript
import { createInfiniteMemory } from 'infinite-memory';
import { streamText } from 'ai';

// Create the infinite memory provider
const memory = createInfiniteMemory({
  openMemoryUrl: 'http://localhost:8080',
  openMemoryApiKey: process.env.OPENMEMORY_API_KEY!,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
});

// Create a model with conversation context
const model = memory('claude-sonnet-4', {
  conversationId: 'conv_123',
  userId: 'user_456'
});

// Use it like any AI SDK model - infinite memory happens automatically
const result = await streamText({
  model,
  messages: [
    { role: 'user', content: 'What did we discuss 100 messages ago?' }
  ],
});

// Stream the response
for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

That's it! The model will:
1. Query OpenMemory for relevant historical context
2. Combine with recent messages
3. Stay under token budget
4. Store the conversation automatically

## How It Works

### Hybrid Retrieval Strategy

For each request, Infinite Memory:

1. **Always includes** the last 3-5 messages (chronological context)
2. **Queries OpenMemory** for semantically relevant older messages
3. **Scores and ranks** by relevance + recency
4. **Fills token budget** (50% of model limit, e.g., 100k for Sonnet 4)
5. **Deduplicates** to avoid sending messages twice

### Automatic Storage

After each request:
- User message → Stored with full JSON structure
- Assistant response → Stored after completion (streaming supported)
- Metadata: `conversationId`, `userId`, `role`, `timestamp`

### Fallback Behavior

If OpenMemory is slow or unavailable:
- Falls back to recent messages only
- Ensures messages fit under context window
- Chat continues without interruption

## API Reference

### `createInfiniteMemory(config)`

Creates an infinite memory provider.

```typescript
const memory = createInfiniteMemory({
  openMemoryUrl: string;           // OpenMemory server URL
  openMemoryApiKey: string;        // OpenMemory API key
  anthropicApiKey: string;         // Anthropic API key
  openMemoryTimeout?: number;      // Query timeout in ms (default: 2000)
});
```

Returns a model creator function: `(modelId, context) => LanguageModel`

### Model Creator

```typescript
const model = memory(modelId, context);
```

**Parameters:**
- `modelId: string` - Claude model ID (e.g., `'claude-sonnet-4'`)
- `context: ModelContext` - Conversation scope
  - `conversationId: string` - Unique conversation identifier
  - `userId: string` - User identifier for scoping

**Returns:** `LanguageModel` - Compatible with all AI SDK functions

### Supported Models

- `claude-sonnet-4` / `claude-sonnet-4-20250514` (200k context)
- `claude-opus-4` / `claude-opus-4-20250514` (200k context)
- `claude-haiku-3-5` / `claude-haiku-3-5-20250514` (100k context)

## Usage with AI SDK

### Streaming

```typescript
import { streamText } from 'ai';

const model = memory('claude-sonnet-4', {
  conversationId: 'conv_123',
  userId: 'user_456'
});

const result = await streamText({
  model,
  messages: [{ role: 'user', content: 'Hello!' }],
});

for await (const chunk of result.textStream) {
  console.log(chunk);
}
```

### With Tools

```typescript
import { generateText, tool } from 'ai';
import { z } from 'zod';

const result = await generateText({
  model: memory('claude-sonnet-4', { conversationId, userId }),
  messages,
  tools: {
    getWeather: tool({
      description: 'Get weather for a location',
      parameters: z.object({
        location: z.string(),
      }),
      execute: async ({ location }) => {
        return { temperature: 72, condition: 'sunny' };
      },
    }),
  },
});
```

### Express.js Integration

```typescript
import express from 'express';
import { createInfiniteMemory } from 'infinite-memory';
import { streamText } from 'ai';

const app = express();
const memory = createInfiniteMemory({ /* config */ });

app.post('/api/chat', async (req, res) => {
  const { messages, conversationId, userId } = req.body;
  
  const model = memory('claude-sonnet-4', {
    conversationId,
    userId
  });
  
  const result = await streamText({ model, messages });
  
  // Stream response back to client
  result.pipeDataStreamToResponse(res);
});
```

## Configuration

### Token Budget

By default, Infinite Memory reserves 50% of the model's context window for input:
- Sonnet 4: 100k tokens for context
- Opus 4: 100k tokens for context  
- Haiku 3.5: 50k tokens for context

This leaves room for output and system prompts.

### OpenMemory Timeout

Queries timeout after 2 seconds by default. Adjust if needed:

```typescript
const memory = createInfiniteMemory({
  // ...
  openMemoryTimeout: 5000, // 5 seconds
});
```

## Architecture

```
Client Request
    ↓
InfiniteMemoryModel.doStream()
    ↓
ContextManager.getRelevantContext()
    ├─→ Get last 3-5 messages (recent)
    ├─→ Query OpenMemory (semantic search)
    └─→ Merge + deduplicate (under token budget)
    ↓
Anthropic API (with augmented context)
    ↓
Stream Response
    ↓
Store in OpenMemory (after completion)
```

## Performance

- **OpenMemory queries**: ~50-200ms (localhost)
- **Fallback mode**: Instant (recent messages only)
- **Storage**: Async, non-blocking
- **Memory overhead**: Minimal (~10MB per conversation)

## Debugging

Enable verbose logging by checking console output:

```
✨ [InfiniteMemory] Provider initialized
🎨 [InfiniteMemory] Creating model: claude-sonnet-4 (conv: conv_123, user: user_456)
🎯 [InfiniteMemory] Context budget: 100,000 tokens (model: claude-sonnet-4)
📌 [InfiniteMemory] Recent 5 messages: 1,234 tokens
🔍 [InfiniteMemory] Found 15 relevant messages
✅ [InfiniteMemory] Context built: 12 retrieved (45,678 tokens) + 5 recent = 46,912 tokens
📝 [InfiniteMemory] Stored message msg_xyz (assistant)
```

## Contributing

Contributions are welcome! Please open an issue or PR on [GitHub](https://github.com/darkresearch/infinite-memory).

## License

Apache 2.0 © [Dark Research](https://github.com/darkresearch)

## Built With

- [Vercel AI SDK](https://sdk.vercel.ai/) - AI framework
- [Anthropic Claude](https://www.anthropic.com/) - Language model
- [OpenMemory](https://openmemory.cavira.app/) - Semantic memory engine

---

**Made with ❤️ by [Dark Research](https://darkresearch.ai)**

