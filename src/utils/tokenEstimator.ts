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
 */
function extractTextFromContent(content: CoreMessage['content']): string {
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
 */
export function estimateMessageTokens(message: CoreMessage): number {
  const textContent = extractTextFromContent(message.content);
  return estimateTokens(textContent);
}

/**
 * Estimate total tokens for an array of messages
 */
export function estimateTotalTokens(messages: CoreMessage[]): number {
  return messages.reduce((total, msg) => total + estimateMessageTokens(msg), 0);
}

