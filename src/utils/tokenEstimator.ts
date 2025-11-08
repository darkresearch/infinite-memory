/**
 * Token estimation utilities
 * Uses simple heuristic: 1 token ≈ 4 characters
 */

import type { CoreMessage } from 'ai';

/**
 * Estimate tokens for a string
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract text from message content for token estimation
 * Handles both CoreMessage format (content field) and UIMessage format (parts array)
 */
function extractTextFromContent(content: CoreMessage['content'] | any): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (part.type === 'text') {
          return part.text;
        }
        if (part.type === 'tool-call') {
          return JSON.stringify(part.args || {});
        }
        if (part.type === 'tool-result') {
          return JSON.stringify(part.result || part.content || '');
        }
        return '';
      })
      .join(' ');
  }

  return '';
}

/**
 * Estimate tokens for a single message
 * Handles both CoreMessage format (content field) and UIMessage format (parts array)
 */
export function estimateMessageTokens(message: CoreMessage | any): number {
  // Handle UIMessage format (has parts array directly)
  if ((message as any).parts) {
    const textContent = extractTextFromContent((message as any).parts);
    const tokens = estimateTokens(textContent);
    return tokens;
  }
  
  // Handle CoreMessage format (has content field)
  if (message.content) {
    const textContent = extractTextFromContent(message.content);
    const tokens = estimateTokens(textContent);
    return tokens;
  }
  
  // No content found
  console.warn('[InfiniteMemory] Message has no content or parts:', { 
    hasContent: !!message.content, 
    hasParts: !!(message as any).parts,
    keys: Object.keys(message)
  });
  return 0;
}

/**
 * Estimate total tokens for an array of messages
 * Handles both CoreMessage and UIMessage formats
 */
export function estimateTotalTokens(messages: (CoreMessage | any)[]): number {
  return messages.reduce((total, msg) => total + estimateMessageTokens(msg), 0);
}

