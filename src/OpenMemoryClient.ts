/**
 * OpenMemory client wrapper for storing and querying messages
 */

import { OpenMemory } from 'openmemory-js';
import type { StoredMessage, OpenMemoryMatch } from './types.js';
import { extractSearchableText } from './utils/messageFormatter.js';

export interface OpenMemoryClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

export class OpenMemoryClient {
  private client: OpenMemory;
  private timeout: number;

  constructor(config: OpenMemoryClientConfig) {
    this.client = new OpenMemory({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.timeout = config.timeout || 2000;
  }

  /**
   * Chunk text into smaller pieces for storage
   */
  private chunkText(text: string, maxChunkSize: number = 100000): string[] {
    // ~25k tokens per chunk (100k chars / 4)
    const chunks: string[] = [];
    
    for (let i = 0; i < text.length; i += maxChunkSize) {
      chunks.push(text.substring(i, i + maxChunkSize));
    }
    
    return chunks;
  }

  /**
   * Store a message in OpenMemory
   * Automatically chunks large messages to avoid 413 errors
   */
  async addMessage(message: StoredMessage): Promise<void> {
    try {
      // Extract searchable text for embedding
      // Pass the full message content (handles both string and object formats)
      const searchableText = extractSearchableText(message.content);

      // Validate that we have actual content to store
      if (!searchableText || searchableText.trim().length === 0) {
        console.error(
          `❌ [InfiniteMemory] Cannot store message ${message.id}: Empty content`,
          {
            role: message.role,
            contentType: typeof message.content,
            hasPartsArray: !!(message.content as any)?.parts,
            partsLength: (message.content as any)?.parts?.length,
            extractedText: searchableText,
          }
        );
        return; // Skip storing empty messages
      }

      console.log(`🔍 [InfiniteMemory] Storing message ${message.id}:`, {
        role: message.role,
        textLength: searchableText.length,
        textPreview: searchableText.substring(0, 100),
      });

      // If text is very large (>200k chars / ~50k tokens), chunk it
      const MAX_SIZE = 200000;
      if (searchableText.length > MAX_SIZE) {
        const chunks = this.chunkText(searchableText, 100000);
        console.log(`📦 [InfiniteMemory] Message too large, storing in ${chunks.length} chunks (parallel)`);
        
        // Store all chunks in parallel for speed
        const startTime = Date.now();
        await Promise.all(
          chunks.map((chunk, i) => {
            const chunkId = `${message.id}-chunk-${i + 1}`;
            
            console.log(`📝 [InfiniteMemory] Storing chunk ${i + 1}/${chunks.length}: ${chunkId}`);
            
            return this.client.add(chunk, {
              user_id: `${message.userId}-${message.role}`,  // ← Separate user vs assistant memories
              tags: [
                'message',
                'chunk',
                message.role,
                message.conversationId,  // Keep conversation in tags for filtering
              ],
              metadata: {
                timestamp: message.timestamp,
                messageId: message.id,
                chunkId,
                chunkIndex: i + 1,
                totalChunks: chunks.length,
                role: message.role,
                userId: message.userId,  // Original userId in metadata
                conversationId: message.conversationId,
              },
            });
          })
        );
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ [InfiniteMemory] Stored message ${message.id} in ${chunks.length} chunks (${duration}s)`);
        return;
      }

      // Store searchable text normally if not too large
      // Let OpenMemory process/summarize as needed
      // Include timestamp for temporal decay/recency
      const result = await this.client.add(searchableText, {
        user_id: `${message.userId}-${message.role}`,  // ← Separate user vs assistant memories
        tags: [
          'message',
          message.role,
          message.conversationId,  // Keep conversation in tags for filtering
        ],
        metadata: {
          timestamp: message.timestamp,
          messageId: message.id,
          role: message.role,
          userId: message.userId,  // Original userId in metadata
          conversationId: message.conversationId,
        },
      });

      console.log(
        `📝 [InfiniteMemory] Stored message ${message.id} (${message.role})`,
        result
      );
    } catch (error) {
      console.error(
        `❌ [InfiniteMemory] Failed to store message ${message.id}:`,
        error
      );
      console.error(`❌ [InfiniteMemory] Message details:`, {
        role: message.role,
        contentType: typeof message.content,
        contentLength: JSON.stringify(message.content).length,
      });
      // Don't throw - storage failures shouldn't break the chat flow
    }
  }

  /**
   * Query for relevant messages from both user and assistant
   */
  async queryRelevant(
    conversationId: string,
    userId: string,
    queryText: string,
    k: number = 20
  ): Promise<{ userMemories: OpenMemoryMatch[], assistantMemories: OpenMemoryMatch[] }> {
    const kPerRole = Math.ceil(k / 2); // Split k between user and assistant
    
    const [userResults, assistantResults] = await Promise.all([
      this.queryByRole(conversationId, userId, 'user', queryText, kPerRole),
      this.queryByRole(conversationId, userId, 'assistant', queryText, kPerRole),
    ]);
    
    return {
      userMemories: userResults,
      assistantMemories: assistantResults,
    };
  }

  /**
   * Query for relevant messages by role (user or assistant)
   */
  private async queryByRole(
    conversationId: string,
    userId: string,
    role: 'user' | 'assistant',
    queryText: string,
    k: number
  ): Promise<OpenMemoryMatch[]> {
    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('OpenMemory query timeout')), this.timeout);
      });

      // Race between query and timeout
      // CRITICAL: Filter by userId-role (separate user vs assistant) and conversationId (via tags)
      const userIdWithRole = `${userId}-${role}`;
      const result = await Promise.race([
        this.client.query(queryText, { 
          k,
          filters: {
            user_id: userIdWithRole,  // ← Query specific role's memories
            tags: [conversationId],  // Filter by conversation
          }
        }),
        timeoutPromise,
      ]);

      console.log(
        `🔍 [InfiniteMemory] Found ${result.matches.length} ${role} memories (filtered by user_id: ${userIdWithRole}, tags: [${conversationId}])`
      );

      // Verify memory isolation for this role
      if (result.matches.length > 0) {
        console.log(`\n🔐 [InfiniteMemory] Verifying ${role} memory isolation...`);
        console.log('─'.repeat(80));
        
        let perfectMatches = 0;
        let crossConversationMatches = 0;
        let legacyMatches = 0;
        
        result.matches.forEach((match, idx) => {
          const metadata = (match as any).metadata || {};
          const tags = (match as any).tags || [];
          const matchUserId = metadata.userId;
          const matchConversationId = metadata.conversationId;
          const hasConversationTag = tags.includes(conversationId);
          
          // OpenMemory doesn't return metadata/tags in responses (only uses them for filtering)
          // So missing metadata means it's likely a legacy message or OpenMemory just doesn't return it
          const hasMissingMetadata = !matchUserId && tags.length === 0;
          
          let status: string;
          
          if (hasMissingMetadata) {
            status = '🔵';
            legacyMatches++;
          } else {
            const userMatch = matchUserId === userId;
            const convMatch = hasConversationTag || matchConversationId === conversationId;
            
            if (userMatch && convMatch) {
              status = '✅';
              perfectMatches++;
            } else if (userMatch && !convMatch) {
              status = '⚠️';
              crossConversationMatches++;
            } else {
              // This shouldn't happen since OpenMemory filtered by user_id
              status = '❌';
              perfectMatches++;
            }
          }
          
          if (idx < 5) {
            console.log(`${status} ${role} memory ${idx + 1}: "${match.content.substring(0, 60)}..."`);
          }
        });
        
        if (result.matches.length > 5) {
          console.log(`... (${result.matches.length - 5} more ${role} memories)`);
        }
        
        console.log('─'.repeat(80));
        console.log(`📊 ${role} memory breakdown:`);
        if (perfectMatches > 0) {
          console.log(`   ✅ Same user + Same conversation: ${perfectMatches}`);
        }
        if (crossConversationMatches > 0) {
          console.log(`   ⚠️  Same user + Different conversation: ${crossConversationMatches}`);
        }
        if (legacyMatches > 0) {
          console.log(`   🔵 Legacy (no metadata, trusting user_id filter): ${legacyMatches}`);
        }
        
        if (legacyMatches === result.matches.length) {
          console.log(`ℹ️  All ${role} memories are legacy. OpenMemory filtered by user_id=${userIdWithRole}, so these should be isolated.`);
        } else if (perfectMatches + crossConversationMatches + legacyMatches === result.matches.length) {
          console.log(`✅ ${role} memories verified - all belong to user ${userId.substring(0, 8)}...`);
        }
        console.log('');
      }

      // Return the processed content directly (OpenMemory's summaries)
      // Extract timestamp - OpenMemory uses 'last_seen_at' field
      return result.matches.map((match): OpenMemoryMatch => ({
        content: match.content, // Use OpenMemory's processed/summarized content
        score: match.score,
        timestamp: (match as any).last_seen_at as number | undefined, // OpenMemory's timestamp field
      }));
    } catch (error) {
      console.error(
        `⚠️ [InfiniteMemory] OpenMemory query for ${role} failed (${error instanceof Error ? error.message : 'unknown'}), will use fallback`
      );
      return [];
    }
  }
}

