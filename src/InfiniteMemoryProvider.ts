/**
 * InfiniteMemory provider that creates models with infinite context
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { OpenMemoryClient } from './OpenMemoryClient.js';
import { ContextManager } from './ContextManager.js';
import { InfiniteMemoryModel } from './InfiniteMemoryModel.js';
import type { InfiniteMemoryConfig, ModelContext } from './types.js';

/**
 * InfiniteMemory provider class
 */
export class InfiniteMemoryProvider {
  private openMemory: OpenMemoryClient;
  private contextManager: ContextManager;
  private anthropicProvider: ReturnType<typeof createAnthropic>;

  constructor(config: InfiniteMemoryConfig) {
    // Initialize OpenMemory client
    this.openMemory = new OpenMemoryClient({
      baseUrl: config.openMemoryUrl,
      apiKey: config.openMemoryApiKey,
      timeout: config.openMemoryTimeout || 2000,
    });

    // Initialize context manager
    this.contextManager = new ContextManager(this.openMemory);

    // Initialize Anthropic provider
    this.anthropicProvider = createAnthropic({
      apiKey: config.anthropicApiKey,
    });

    console.log('✨ [InfiniteMemory] Provider initialized');
  }

  /**
   * Create a model with infinite memory for a specific conversation
   */
  createModel(modelId: string, context: ModelContext): LanguageModel {
    console.log(
      `🎨 [InfiniteMemory] Creating model: ${modelId} (conv: ${context.conversationId}, user: ${context.userId})`
    );

    // Get the base Anthropic model
    const baseModel = this.anthropicProvider(modelId);

    // Wrap it with infinite memory capabilities
    return new InfiniteMemoryModel(
      baseModel,
      this.contextManager,
      context,
      modelId
    );
  }
}

