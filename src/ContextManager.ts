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

/**
 * Extract base message ID from chunk IDs like "uuid-chunk-1" -> "uuid"
 */
function extractBaseMessageId(id: string): string {
  const match = id.match(/^(.+)-chunk-\d+$/);
  return match ? match[1] : id;
}

/**
 * Create a placeholder for large stored messages
 */
function createMemoryPlaceholder(messageId: string, content: string | any[]): string {
  const preview = extractSearchableText({ role: 'user', content })
    .substring(0, 500);
  
  return `<LARGE_MESSAGE_IN_MEMORY id="${messageId}">
This message has been stored in your long-term memory. To recall details, search your memory.

Preview: "${preview}..."
</LARGE_MESSAGE_IN_MEMORY>`;
}

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

    // Check if any large messages have already been stored in OpenMemory
    // Only check messages >50k tokens to avoid unnecessary queries
    const largeMessages = messages.filter(msg => {
      const tokens = estimateTotalTokens([msg]);
      return tokens > 50000; // ~200k chars
    });

    let storedMessageIds = new Set<string>();
    if (largeMessages.length > 0) {
      console.log(`🔍 [InfiniteMemory] Checking if ${largeMessages.length} large messages are already stored...`);
      
      const largeMessageIds = largeMessages
        .map(msg => (msg as any).id)
        .filter(Boolean);
      
      if (largeMessageIds.length > 0) {
        storedMessageIds = await this.openMemory.checkMessagesExist(
          context.userId,
          largeMessageIds
        );
        console.log(`✅ [InfiniteMemory] Found ${storedMessageIds.size} large messages already in memory`);
      }
    }

    // Replace large stored messages with placeholders to prevent re-processing
    const processedMessages = messages.map(msg => {
      const msgId = (msg as any).id;
      if (!msgId) return msg;
      
      const tokens = estimateTotalTokens([msg]);
      const isLarge = tokens > 50000;
      
      if (!isLarge) return msg; // Small messages pass through
      
      // Check if this message (or its chunks) has been stored
      const baseId = extractBaseMessageId(msgId);
      const isStored = storedMessageIds.has(msgId) || storedMessageIds.has(baseId);
      
      if (isStored) {
        const placeholder = createMemoryPlaceholder(msgId, msg.content);
        console.log(`🔄 [InfiniteMemory] Replacing large stored message ${msgId} with placeholder (${placeholder.length} chars)`);
        
        // Create a new message object with placeholder content
        // Important: create a fresh object to ensure content is replaced
        const replacedMessage = {
          role: msg.role,
          content: placeholder,  // Simple string content
          id: msgId,
        } as CoreMessage;
        
        return replacedMessage;
      }
      
      return msg;
    }) as CoreMessage[];

    // Always include the last 3-5 messages chronologically
    const recentCount = Math.min(5, processedMessages.length);
    const recentMessages = processedMessages.slice(-recentCount);
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

    const { userMemories, assistantMemories } = await this.openMemory.queryRelevant(
      context.conversationId,
      context.userId,
      queryText,
      20 // Get top 20 candidates total (split between user/assistant)
    );

    const totalMatches = userMemories.length + assistantMemories.length;
    console.log(`🔍 [InfiniteMemory] Found ${totalMatches} relevant memories (${userMemories.length} from user, ${assistantMemories.length} from assistant)`);

    // Use OpenMemory's processed content directly (summarized memories)
    // No need to fetch from Supabase - the summaries are perfect for context
    if (totalMatches === 0) {
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

    // Token-aware limiting: include matches from both user and assistant within budget
    // Reserve space for recent messages + historical context
    const remainingBudget = inputBudget - recentTokens;
    const fittingUserMemories = [];
    const fittingAssistantMemories = [];
    let totalContextTokens = 0;

    // Interleave user and assistant memories by relevance
    const allMemories = [
      ...userMemories.map(m => ({ ...m, role: 'user' as const })),
      ...assistantMemories.map(m => ({ ...m, role: 'assistant' as const })),
    ].sort((a, b) => b.score - a.score); // Sort by relevance score

    for (const match of allMemories) {
      const matchTokens = Math.ceil(match.content.length / 4);
      // Rough estimate for JSON formatting overhead (~50 tokens per match)
      const formattedTokens = matchTokens + 50;
      
      if (totalContextTokens + formattedTokens <= remainingBudget) {
        if (match.role === 'user') {
          fittingUserMemories.push(match);
        } else {
          fittingAssistantMemories.push(match);
        }
        totalContextTokens += formattedTokens;
      } else {
        const totalFitting = fittingUserMemories.length + fittingAssistantMemories.length;
        console.log(`⚠️ [InfiniteMemory] Stopping at ${totalFitting}/${allMemories.length} matches to stay within budget`);
        break;
      }
    }

    const totalFittingMatches = fittingUserMemories.length + fittingAssistantMemories.length;
    
    if (totalFittingMatches === 0) {
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

    console.log(`📊 [InfiniteMemory] Using ${totalFittingMatches} memories (~${totalContextTokens.toLocaleString()} tokens) within budget (${fittingUserMemories.length} user, ${fittingAssistantMemories.length} assistant)`);

    // Format user memories
    const userMemoryObjects = fittingUserMemories.map((match) => {
      const memoryObj: any = {
        content: match.content,
        relevance: match.score,
      };
      if (match.timestamp) {
        memoryObj.timestamp_ms = match.timestamp;
      }
      return JSON.stringify(memoryObj, null, 2);
    });
    
    // Format assistant memories
    const assistantMemoryObjects = fittingAssistantMemories.map((match) => {
      const memoryObj: any = {
        content: match.content,
        relevance: match.score,
      };
      if (match.timestamp) {
        memoryObj.timestamp_ms = match.timestamp;
      }
      return JSON.stringify(memoryObj, null, 2);
    });
    
    // Build historical context with clear attribution
    let historicalContext = `=== Relevant context from past conversations ===\n`;
    historicalContext += `Each memory is a JSON object with timestamp_ms (Unix epoch), content, and relevance score.\n`;
    historicalContext += `More recent timestamps and higher relevance scores are more important.\n\n`;
    
    if (fittingUserMemories.length > 0) {
      historicalContext += `=== What you told me ===\n`;
      historicalContext += `${userMemoryObjects.join('\n\n')}\n\n`;
    }
    
    if (fittingAssistantMemories.length > 0) {
      historicalContext += `=== What I told you ===\n`;
      historicalContext += `${assistantMemoryObjects.join('\n\n')}`;
    }
    
    const contextTokens = Math.ceil(historicalContext.length / 4);

    console.log(
      `✅ [InfiniteMemory] Context built: ${totalFittingMatches} memories (${contextTokens.toLocaleString()} tokens) + ${recentCount} recent messages`
    );
    console.log('📜 [InfiniteMemory] Historical context:');
    console.log('─'.repeat(80));
    console.log(historicalContext);
    console.log('─'.repeat(80));
    console.log('💡 [InfiniteMemory] Note: Memories separated by speaker for clear attribution');

    return {
      messages: recentMessages,
      historicalContext,
      metadata: {
        estimatedTokens: recentTokens + contextTokens,
        recentCount,
        retrievedCount: totalFittingMatches,
        usedOpenMemory: true,
      },
    };
  }
}

