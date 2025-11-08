/**
 * OpenMemory client wrapper for storing and querying messages
 */

import OpenMemory from 'openmemory-js';
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
              tags: [
                'message',
                'chunk',
                message.role,
                message.conversationId,
                message.userId,
              ],
              metadata: {
                timestamp: message.timestamp,
                messageId: message.id,
                chunkId,
                chunkIndex: i + 1,
                totalChunks: chunks.length,
                role: message.role,
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
        tags: [
          'message',
          message.role,
          message.conversationId,
          message.userId,
        ],
        metadata: {
          timestamp: message.timestamp,
          messageId: message.id,
          role: message.role,
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
   * Query for relevant message IDs
   */
  async queryRelevant(
    _conversationId: string,
    _userId: string,
    queryText: string,
    k: number = 20
  ): Promise<OpenMemoryMatch[]> {
    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('OpenMemory query timeout')), this.timeout);
      });

      // Race between query and timeout
      const result = await Promise.race([
        this.client.query(queryText, { k } as any),
        timeoutPromise,
      ]);

      console.log(
        `🔍 [InfiniteMemory] Found ${result.matches.length} relevant matches`
      );

      // Debug: Log what we're getting from OpenMemory
      if (result.matches.length > 0) {
        console.log('🔬 [InfiniteMemory] Sample match structure:', JSON.stringify(result.matches[0], null, 2));
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
        `⚠️ [InfiniteMemory] OpenMemory query failed (${error instanceof Error ? error.message : 'unknown'}), will use fallback`
      );
      return [];
    }
  }
}

