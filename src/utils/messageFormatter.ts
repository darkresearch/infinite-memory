/**
 * Message formatting utilities
 */

import type { CoreMessage } from 'ai';
import type { StoredMessage } from '../types.js';

/**
 * Extract searchable text from a message for OpenMemory embedding
 * Handles both CoreMessage format and UIMessage format (with parts array)
 */
export function extractSearchableText(message: any): string {
  // Handle UIMessage format (from AI SDK with parts array)
  if (message.parts && Array.isArray(message.parts)) {
    const textParts: string[] = [];
    
    for (const part of message.parts) {
      if (part.type === 'text' && part.text) {
        textParts.push(part.text);
      } else if (part.type === 'reasoning' && part.text) {
        // Include reasoning content for searchability
        textParts.push(part.text);
      } else if (part.type === 'tool-call') {
        textParts.push(`[Tool: ${part.toolName}]`);
        textParts.push(JSON.stringify(part.args || {}));
      } else if (part.type === 'tool-result') {
        textParts.push(`[Result: ${part.toolName || 'unknown'}]`);
        const result = part.result || part.content;
        if (typeof result === 'string') {
          textParts.push(result);
        } else {
          textParts.push(JSON.stringify(result || {}));
        }
      }
    }
    
    return textParts.join(' ').trim();
  }
  
  // Handle CoreMessage format (with content field)
  const content = message.content;

  if (typeof content === 'string') {
    return content;
  }

  // Handle content as object with parts property (e.g., { parts: [...] })
  if (content && typeof content === 'object' && 'parts' in content && Array.isArray(content.parts)) {
    const textParts: string[] = [];
    
    for (const part of content.parts) {
      if (part.type === 'text' && part.text) {
        textParts.push(part.text);
      } else if (part.type === 'reasoning' && part.text) {
        textParts.push(part.text);
      } else if (part.type === 'tool-call') {
        textParts.push(`[Tool: ${part.toolName}]`);
        textParts.push(JSON.stringify(part.args || {}));
      } else if (part.type === 'tool-result') {
        textParts.push(`[Result: ${part.toolName || 'unknown'}]`);
        const result = part.result || part.content;
        if (typeof result === 'string') {
          textParts.push(result);
        } else {
          textParts.push(JSON.stringify(result || {}));
        }
      }
    }
    
    return textParts.join(' ').trim();
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

    return textParts.join(' ').trim();
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
 * Handles both parts array (UIMessage) and content field (CoreMessage)
 */
export function toCoreMessage(stored: StoredMessage): CoreMessage {
  // If content is an array of parts, convert to CoreMessage format
  if (Array.isArray(stored.content)) {
    // Check if it's a parts array (has type field)
    if (stored.content.length > 0 && stored.content[0].type) {
      // Convert parts array to content array for CoreMessage
      return {
        role: stored.role as any,
        content: stored.content as any, // Parts array is valid as content
      };
    }
  }
  
  // Otherwise use as-is
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

