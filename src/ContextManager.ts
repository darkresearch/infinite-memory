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
} from './utils/tokenEstimator.js';
import { extractSearchableText } from './utils/messageFormatter.js';
import { getModelLimit } from './types.js';
import { summarizeConversation, summarizeLargeMessage } from './utils/summarizer.js';

export class ContextManager {
  constructor(
    private openMemory: OpenMemoryClient,
    private anthropicApiKey: string
  ) {}

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

    // If recent messages exceed budget, use Claude to summarize
    if (recentTokens > inputBudget) {
      console.log(`🔄 [InfiniteMemory] Recent messages (${recentTokens.toLocaleString()} tokens) exceed budget (${inputBudget.toLocaleString()}), summarizing with Claude...`);
      
      try {
        const latestMessage = messages[messages.length - 1];
        const latestTokens = estimateTotalTokens([latestMessage]);
        
        // CASE 1: Single massive message
        if (latestTokens > inputBudget) {
          console.log(`⚠️ [InfiniteMemory] Single message too large (${latestTokens.toLocaleString()} tokens), summarizing it...`);
          
          const summary = await summarizeLargeMessage(
            latestMessage,
            this.anthropicApiKey,
            modelId
          );
          
          const summaryTokens = Math.ceil(summary.length / 4);
          console.log(`✅ [InfiniteMemory] Summarized single message: ${latestTokens.toLocaleString()} → ${summaryTokens.toLocaleString()} tokens`);
          
          return {
            messages: [],
            historicalContext: `[SUMMARIZED LARGE MESSAGE]\n${summary}`,
            metadata: {
              estimatedTokens: summaryTokens,
              recentCount: 0,
              retrievedCount: 0,
              usedOpenMemory: false,
              summarized: true,
            }
          };
        }
        
        // CASE 2: Many large messages
        const toSummarize = messages.slice(-recentCount, -1); // All but latest
        
        const summary = await summarizeConversation(
          toSummarize,
          this.anthropicApiKey,
          modelId
        );
        
        const summaryTokens = Math.ceil(summary.length / 4);
        
        console.log(`✅ [InfiniteMemory] Summarized ${toSummarize.length} messages: ${recentTokens.toLocaleString()} → ${(summaryTokens + latestTokens).toLocaleString()} tokens`);
        
        return {
          messages: [latestMessage],
          historicalContext: `[SUMMARIZED RECENT CONVERSATION]\n${summary}\n\n[CURRENT MESSAGE FOLLOWS]`,
          metadata: {
            estimatedTokens: latestTokens + summaryTokens,
            recentCount: 1,
            retrievedCount: 0,
            usedOpenMemory: false,
            summarized: true,
          }
        };
      } catch (error) {
        console.error('⚠️ [InfiniteMemory] Summarization failed, falling back to truncation:', error);
        
        const minRecent = Math.min(3, messages.length);
        const truncatedRecent = messages.slice(-minRecent);
        const truncatedTokens = estimateTotalTokens(truncatedRecent);
        
        return {
          messages: truncatedRecent,
          historicalContext: null,
          metadata: {
            estimatedTokens: truncatedTokens,
            recentCount: minRecent,
            retrievedCount: 0,
            usedOpenMemory: false,
          }
        };
      }
    }

    // Query OpenMemory for relevant older messages
    const latestMessage = messages[messages.length - 1];
    const queryText = extractSearchableText(latestMessage);

    const matches = await this.openMemory.queryRelevant(
      context.conversationId,
      context.userId,
      queryText,
      20 // Get top 20 candidates
    );

    console.log(`🔍 [InfiniteMemory] Found ${matches.length} relevant memories`);

    // Use OpenMemory's processed content directly (summarized memories)
    // No need to fetch from Supabase - the summaries are perfect for context
    if (matches.length === 0) {
      console.log(
        `📭 [InfiniteMemory] No retrieved memories, using recent only`
      );
      return {
        messages: recentMessages,
        historicalContext: null,
        metadata: {
          estimatedTokens: recentTokens,
          recentCount,
          retrievedCount: 0,
          usedOpenMemory: false,
        },
      };
    }

    // Format memories as JSON objects for clear delineation
    const memoryObjects = matches.map((match) => {
      const memoryObj: any = {
        content: match.content,
        relevance: match.score,
      };
      
      // Add timestamp if available
      if (match.timestamp) {
        memoryObj.timestamp_ms = match.timestamp;
      }
      
      return JSON.stringify(memoryObj, null, 2);
    });
    
    const historicalContext = `=== Relevant context from past conversations ===\nEach memory is a JSON object with timestamp_ms (Unix epoch), content, and relevance score.\nMore recent timestamps and higher relevance scores are more important.\n\n${memoryObjects.join('\n\n')}`;
    
    const contextTokens = Math.ceil(historicalContext.length / 4);

    console.log(
      `✅ [InfiniteMemory] Context built: ${matches.length} memories (${contextTokens.toLocaleString()} tokens) + ${recentCount} recent messages`
    );
    console.log('📜 [InfiniteMemory] Historical context (sorted by relevance + recency):');
    console.log('─'.repeat(80));
    console.log(historicalContext);
    console.log('─'.repeat(80));
    console.log('💡 [InfiniteMemory] Note: OpenMemory uses temporal decay - recent memories are prioritized');

    return {
      messages: recentMessages,
      historicalContext,
      metadata: {
        estimatedTokens: recentTokens + contextTokens,
        recentCount,
        retrievedCount: matches.length,
        usedOpenMemory: true,
      },
    };
  }
}

