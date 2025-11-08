/**
 * Type definitions for Infinite Memory package
 */

import type { CoreMessage, LanguageModel } from 'ai';

/**
 * Configuration for InfiniteMemory
 */
export interface InfiniteMemoryConfig {
  /** OpenMemory server URL */
  openMemoryUrl: string;
  /** OpenMemory API key */
  openMemoryApiKey: string;
  /** Anthropic API key */
  anthropicApiKey: string;
  /** Timeout for OpenMemory queries in milliseconds (default: 2000) */
  openMemoryTimeout?: number;
}

/**
 * Context for creating a model with conversation scope
 */
export interface ModelContext {
  /** Conversation ID to scope memories */
  conversationId: string;
  /** User ID for user-scoped memories */
  userId: string;
}

/**
 * Stored message in OpenMemory
 */
export interface StoredMessage {
  /** Message ID */
  id: string;
  /** Conversation ID */
  conversationId: string;
  /** User ID */
  userId: string;
  /** Message role */
  role: 'user' | 'assistant' | 'system';
  /** Full message content (preserved JSON structure) */
  content: CoreMessage['content'];
  /** Timestamp */
  timestamp: number;
}

/**
 * Retrieved message from OpenMemory
 */
export interface RetrievedMessage {
  /** Original stored message */
  message: StoredMessage;
  /** Relevance score from OpenMemory */
  score: number;
}

/**
 * Context retrieval result
 */
export interface ContextResult {
  /** Messages to send to Claude */
  messages: CoreMessage[];
  /** Metadata about the retrieval */
  metadata: {
    /** Total estimated tokens */
    estimatedTokens: number;
    /** Number of recent messages included */
    recentCount: number;
    /** Number of retrieved relevant messages */
    retrievedCount: number;
    /** Whether OpenMemory was used successfully */
    usedOpenMemory: boolean;
  };
}

/**
 * Model limits mapping
 */
export const MODEL_LIMITS: Record<string, number> = {
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-haiku-3-5-20250514': 100000,
  // Shorthand versions
  'claude-sonnet-4': 200000,
  'claude-opus-4': 200000,
  'claude-haiku-3-5': 100000,
};

/**
 * Get context window limit for a model
 */
export function getModelLimit(modelId: string): number {
  return MODEL_LIMITS[modelId] || 200000; // Default to 200k
}

/**
 * Factory function type for creating models
 */
export type ModelCreator = (
  modelId: string,
  context: ModelContext
) => LanguageModel;

