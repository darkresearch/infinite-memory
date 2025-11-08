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
          
          // Store the summary to OpenMemory (replaces the bloated original)
          // This prevents re-summarization on the next turn
          if ((latestMessage as any).id) {
            try {
              await this.storeMessage(
                context,
                latestMessage.role as 'user' | 'assistant',
                summary, // Store the summary, not the original
                (latestMessage as any).id
              );
              console.log(`💾 [InfiniteMemory] Stored summarized version of message ${(latestMessage as any).id}`);
            } catch (error) {
              console.error(`⚠️ [InfiniteMemory] Failed to store summary:`, error);
            }
          }
          
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
        
        // Store summaries of large messages to OpenMemory (replaces bloated originals)
        // This prevents re-summarization on the next turn
        for (const msg of toSummarize) {
          if ((msg as any).id) {
            try {
              await this.storeMessage(
                context,
                msg.role as 'user' | 'assistant',
                summary, // Store the summary
                (msg as any).id
              );
              console.log(`💾 [InfiniteMemory] Stored summarized version of message ${(msg as any).id}`);
            } catch (error) {
              console.error(`⚠️ [InfiniteMemory] Failed to store summary:`, error);
            }
          }
        }
        
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

    // Token-aware limiting: only include matches that fit within budget
    // Reserve space for recent messages + historical context
    const remainingBudget = inputBudget - recentTokens;
    const fittingMatches = [];
    let totalContextTokens = 0;

    for (const match of matches) {
      const matchTokens = Math.ceil(match.content.length / 4);
      // Rough estimate for JSON formatting overhead (~50 tokens per match)
      const formattedTokens = matchTokens + 50;
      
      if (totalContextTokens + formattedTokens <= remainingBudget) {
        fittingMatches.push(match);
        totalContextTokens += formattedTokens;
      } else {
        console.log(`⚠️ [InfiniteMemory] Stopping at ${fittingMatches.length}/${matches.length} matches to stay within budget`);
        break;
      }
    }

    if (fittingMatches.length === 0) {
      console.log(
        `📭 [InfiniteMemory] No memories fit within budget, using recent only`
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

    console.log(`📊 [InfiniteMemory] Using ${fittingMatches.length} memories (~${totalContextTokens.toLocaleString()} tokens) within budget`);

    // Format memories as JSON objects for clear delineation
    const memoryObjects = fittingMatches.map((match) => {
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
      `✅ [InfiniteMemory] Context built: ${fittingMatches.length} memories (${contextTokens.toLocaleString()} tokens) + ${recentCount} recent messages`
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
        retrievedCount: fittingMatches.length,
        usedOpenMemory: true,
      },
    };
  }
}

