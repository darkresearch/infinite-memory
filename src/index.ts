import { OpenMemoryClient } from './OpenMemoryClient.js';
import { ContextManager } from './ContextManager.js';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { InfiniteMemoryConfig } from './types.js';
import type { CoreMessage } from 'ai';

export { InfiniteMemoryConfig, ModelContext } from './types.js';

/**
 * Type for the return value of createInfiniteMemory
 */
export type InfiniteMemory = ReturnType<typeof createInfiniteMemory>;

/**
 * Create an infinite memory instance for managing conversation context
 * 
 * @example
 * ```typescript
 * const memory = createInfiniteMemory({
 *   openMemoryUrl: 'http://localhost:8080',
 *   openMemoryApiKey: 'your-api-key',
 *   anthropicApiKey: 'your-anthropic-key'
 * });
 * 
 * // Get relevant context
 * const context = await memory.getRelevantContext(
 *   conversationId,
 *   userId,
 *   messages,
 *   'claude-sonnet-4-20250514'
 * );
 * 
 * // Store a message
 * await memory.storeMessage(
 *   conversationId,
 *   userId,
 *   'user',
 *   'Hello!',
 *   'msg-123'
 * );
 * ```
 */
export function createInfiniteMemory(config: InfiniteMemoryConfig) {
  const openMemoryClient = new OpenMemoryClient({
    baseUrl: config.openMemoryUrl,
    apiKey: config.openMemoryApiKey,
    timeout: config.openMemoryTimeout,
  });

  const anthropic = createAnthropic({
    apiKey: config.anthropicApiKey,
  });

  const contextManager = new ContextManager(openMemoryClient, config.anthropicApiKey);

  return {
    /**
     * Get relevant context for the current conversation
     * Combines recent messages with semantically relevant older messages
     */
    async getRelevantContext(
      conversationId: string,
      userId: string,
      messages: CoreMessage[],
      modelId: string
    ) {
      return contextManager.getRelevantContext(
        { conversationId, userId },
        messages,
        modelId
      );
    },

    /**
     * Store a message in OpenMemory for future retrieval
     */
    async storeMessage(
      conversationId: string,
      userId: string,
      role: 'user' | 'assistant',
      content: string | any[],
      messageId: string
    ) {
      return contextManager.storeMessage(
        { conversationId, userId },
        role,
        content,
        messageId
      );
    },

    /**
     * Get the Anthropic model instance for making calls
     */
    getModel(modelId: string) {
      return anthropic(modelId);
    },
  };
}
