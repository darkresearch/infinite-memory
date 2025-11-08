/**
 * OpenMemory client wrapper for storing and querying messages
 */

import OpenMemory from 'openmemory-js';
import type { StoredMessage, RetrievedMessage } from './types.js';
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
   * Store a message in OpenMemory
   */
  async addMessage(message: StoredMessage): Promise<void> {
    try {
      // Extract searchable text for embedding
      const searchableText = extractSearchableText({
        role: message.role as any,
        content: message.content as any,
      });

      // Store with tags for scoping and metadata for reconstruction
      await this.client.add(searchableText, {
        tags: [
          'message',
          message.role,
          message.conversationId,
          message.userId,
        ],
        metadata: {
          id: message.id,
          conversationId: message.conversationId,
          userId: message.userId,
          role: message.role,
          content: JSON.stringify(message.content),
          timestamp: message.timestamp,
        },
      });

      console.log(
        `📝 [InfiniteMemory] Stored message ${message.id} (${message.role})`
      );
    } catch (error) {
      console.error(
        `❌ [InfiniteMemory] Failed to store message ${message.id}:`,
        error
      );
      // Don't throw - storage failures shouldn't break the chat flow
    }
  }

  /**
   * Query for relevant messages
   */
  async queryRelevant(
    _conversationId: string,
    _userId: string,
    queryText: string,
    k: number = 20
  ): Promise<RetrievedMessage[]> {
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
        `🔍 [InfiniteMemory] Found ${result.matches.length} relevant messages`
      );

      // Convert OpenMemory results to RetrievedMessage format
      return result.matches
        .map((match): RetrievedMessage | null => {
          try {
            // Reconstruct the stored message from metadata
            const metadata = match.metadata as any;
            const storedMessage: StoredMessage = {
              id: metadata.id,
              conversationId: metadata.conversationId,
              userId: metadata.userId,
              role: metadata.role,
              content: JSON.parse(metadata.content),
              timestamp: metadata.timestamp,
            };

            return {
              message: storedMessage,
              score: match.score,
            };
          } catch (error) {
            console.error(
              '❌ [InfiniteMemory] Failed to parse stored message:',
              error
            );
            return null;
          }
        })
        .filter((m): m is RetrievedMessage => m !== null);
    } catch (error) {
      console.error(
        `⚠️ [InfiniteMemory] OpenMemory query failed (${error instanceof Error ? error.message : 'unknown'}), will use fallback`
      );
      return [];
    }
  }
}

