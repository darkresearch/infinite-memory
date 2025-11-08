/**
 * @darkresearch/infinite-memory
 * 
 * Infinite context windows for Claude via OpenMemory semantic retrieval
 */

import { InfiniteMemoryProvider } from './InfiniteMemoryProvider.js';
import type { InfiniteMemoryConfig, ModelContext, ModelCreator } from './types.js';

/**
 * Create an infinite memory provider
 * 
 * @example
 * ```typescript
 * const memory = createInfiniteMemory({
 *   openMemoryUrl: 'http://localhost:8080',
 *   openMemoryApiKey: process.env.OPENMEMORY_API_KEY!,
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
 * });
 * 
 * const model = memory('claude-sonnet-4', {
 *   conversationId: 'conv_123',
 *   userId: 'user_456'
 * });
 * 
 * const result = await streamText({
 *   model,
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * ```
 */
export function createInfiniteMemory(
  config: InfiniteMemoryConfig
): ModelCreator {
  const provider = new InfiniteMemoryProvider(config);
  
  return (modelId: string, context: ModelContext) => {
    return provider.createModel(modelId, context);
  };
}

// Export types
export type {
  InfiniteMemoryConfig,
  ModelContext,
  ModelCreator,
  StoredMessage,
  RetrievedMessage,
  ContextResult,
} from './types.js';

// Re-export model limits
export { MODEL_LIMITS, getModelLimit } from './types.js';

