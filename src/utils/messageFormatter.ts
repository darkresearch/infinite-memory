/**
 * Message formatting utilities
 */

import type { CoreMessage } from 'ai';
import type { StoredMessage } from '../types.js';

/**
 * Extract searchable text from a message for OpenMemory embedding
 */
export function extractSearchableText(message: CoreMessage): string {
  const content = message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];

    for (const part of content) {
      if (part.type === 'text') {
        textParts.push(part.text);
      } else if (part.type === 'tool-call') {
        // Include tool name and args for searchability
        const toolPart = part as any;
        textParts.push(`[Tool: ${toolPart.toolName}]`);
        textParts.push(JSON.stringify(toolPart.args || {}));
      } else if (part.type === 'tool-result') {
        // Include tool results for searchability
        const resultPart = part as any;
        textParts.push(`[Result: ${resultPart.toolName || 'unknown'}]`);
        const result = resultPart.result || resultPart.content;
        if (typeof result === 'string') {
          textParts.push(result);
        } else {
          textParts.push(JSON.stringify(result || {}));
        }
      }
    }

    return textParts.join(' ');
  }

  return '';
}

/**
 * Convert CoreMessage to StoredMessage format
 */
export function toStoredMessage(
  message: CoreMessage,
  conversationId: string,
  userId: string,
  messageId: string
): StoredMessage {
  return {
    id: messageId,
    conversationId,
    userId,
    role: message.role as 'user' | 'assistant' | 'system',
    content: message.content,
    timestamp: Date.now(),
  };
}

/**
 * Convert StoredMessage back to CoreMessage
 */
export function toCoreMessage(stored: StoredMessage): CoreMessage {
  return {
    role: stored.role as any,
    content: stored.content as any,
  };
}

/**
 * Deduplicate messages by ID, keeping the first occurrence
 */
export function deduplicateMessages(
  messages: CoreMessage[],
  storedMessages: StoredMessage[]
): CoreMessage[] {
  const seenIds = new Set<string>();
  const result: CoreMessage[] = [];

  for (const msg of messages) {
    // For messages from the request, we don't have IDs, so just include them
    // We'll deduplicate based on the stored messages we're adding
    result.push(msg);
  }

  // Add stored messages that aren't already in the recent set
  for (const stored of storedMessages) {
    if (!seenIds.has(stored.id)) {
      seenIds.add(stored.id);
      result.push(toCoreMessage(stored));
    }
  }

  return result;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

