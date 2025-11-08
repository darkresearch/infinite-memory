/**
 * Context management for hybrid retrieval strategy
 */

import type { CoreMessage } from 'ai';
import { OpenMemoryClient } from './OpenMemoryClient.js';
import type {
  StoredMessage,
  ContextResult,
  ModelContext,
} from './types.js';
import {
  estimateTotalTokens,
  estimateMessageTokens,
} from './utils/tokenEstimator.js';
import { extractSearchableText, toCoreMessage } from './utils/messageFormatter.js';
import { getModelLimit } from './types.js';

export class ContextManager {
  constructor(private openMemory: OpenMemoryClient) {}

  /**
   * Store a message in OpenMemory
   */
  async storeMessage(
    context: ModelContext,
    role: 'user' | 'assistant' | 'system',
    content: CoreMessage['content'],
    messageId: string
  ): Promise<void> {
    const message: StoredMessage = {
      id: messageId,
      conversationId: context.conversationId,
      userId: context.userId,
      role,
      content,
      timestamp: Date.now(),
    };

    await this.openMemory.addMessage(message);
  }

  /**
   * Get relevant context for a new request with token budget management
   */
  async getRelevantContext(
    context: ModelContext,
    messages: CoreMessage[],
    modelId: string
  ): Promise<ContextResult> {
    const modelLimit = getModelLimit(modelId);
    const inputBudget = Math.floor(modelLimit * 0.5); // Reserve 50% for input

    console.log(
      `🎯 [InfiniteMemory] Context budget: ${inputBudget.toLocaleString()} tokens (model: ${modelId})`
    );

    // Always include the last 3-5 messages chronologically
    const recentCount = Math.min(5, messages.length);
    const recentMessages = messages.slice(-recentCount);
    const recentTokens = estimateTotalTokens(recentMessages);

    console.log(
      `📌 [InfiniteMemory] Recent ${recentCount} messages: ${recentTokens.toLocaleString()} tokens`
    );

    // If recent messages already exceed budget, truncate to last 3
    if (recentTokens > inputBudget) {
      const minRecent = Math.min(3, messages.length);
      const truncatedRecent = messages.slice(-minRecent);
      const truncatedTokens = estimateTotalTokens(truncatedRecent);

      console.warn(
        `⚠️ [InfiniteMemory] Recent messages exceed budget, using last ${minRecent} messages (${truncatedTokens.toLocaleString()} tokens)`
      );

      return {
        messages: truncatedRecent,
        metadata: {
          estimatedTokens: truncatedTokens,
          recentCount: minRecent,
          retrievedCount: 0,
          usedOpenMemory: false,
        },
      };
    }

    // Query OpenMemory for relevant older messages
    const latestMessage = messages[messages.length - 1];
    const queryText = extractSearchableText(latestMessage);

    const retrievedMessages = await this.openMemory.queryRelevant(
      context.conversationId,
      context.userId,
      queryText,
      20 // Get top 20 candidates
    );

    // If OpenMemory failed or returned nothing, use recent only
    if (retrievedMessages.length === 0) {
      console.log(
        `📭 [InfiniteMemory] No retrieved messages, using recent only`
      );
      return {
        messages: recentMessages,
        metadata: {
          estimatedTokens: recentTokens,
          recentCount,
          retrievedCount: 0,
          usedOpenMemory: false,
        },
      };
    }

    // Sort retrieved by score (relevance) and add until budget is reached
    const remainingBudget = inputBudget - recentTokens;
    const selectedRetrieved: StoredMessage[] = [];
    let retrievedTokens = 0;

    for (const retrieved of retrievedMessages) {
      // Skip if this message is already in recent set (rough check by timestamp)
      const isRecent = recentMessages.some(
        (recent) =>
          JSON.stringify(recent.content) ===
          JSON.stringify(retrieved.message.content)
      );

      if (isRecent) {
        continue;
      }

      const msgTokens = estimateMessageTokens(
        toCoreMessage(retrieved.message)
      );

      if (retrievedTokens + msgTokens <= remainingBudget) {
        selectedRetrieved.push(retrieved.message);
        retrievedTokens += msgTokens;
      }
    }

    // Sort retrieved messages chronologically (oldest first)
    selectedRetrieved.sort((a, b) => a.timestamp - b.timestamp);

    // Combine: retrieved (oldest to newest) + recent (oldest to newest)
    const combinedMessages: CoreMessage[] = [
      ...selectedRetrieved.map(toCoreMessage),
      ...recentMessages,
    ];

    const totalTokens = recentTokens + retrievedTokens;

    console.log(
      `✅ [InfiniteMemory] Context built: ${selectedRetrieved.length} retrieved (${retrievedTokens.toLocaleString()} tokens) + ${recentCount} recent = ${totalTokens.toLocaleString()} tokens`
    );

    return {
      messages: combinedMessages,
      metadata: {
        estimatedTokens: totalTokens,
        recentCount,
        retrievedCount: selectedRetrieved.length,
        usedOpenMemory: true,
      },
    };
  }
}

