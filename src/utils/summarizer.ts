/**
 * Summarization utilities using Claude API
 */

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { CoreMessage } from 'ai';

const SUMMARIZATION_PROMPT = `Summarize the following conversation, preserving ALL critical information:

MUST PRESERVE:
- Tool calls and their results (with exact function names and key data)
- Code snippets (with language and context)
- Specific data points, numbers, addresses, IDs
- User preferences, decisions, and stated goals
- Key facts and conclusions

FORMAT:
Use a structured summary with clear sections. Be concise but complete.

CONVERSATION:`;

/**
 * Summarize multiple messages from a conversation
 */
export async function summarizeConversation(
  messages: CoreMessage[],
  anthropicApiKey: string,
  modelId: string = 'claude-sonnet-4-20250514'
): Promise<string> {
  const anthropic = createAnthropic({ apiKey: anthropicApiKey });
  
  const result = await generateText({
    model: anthropic(modelId),
    messages: [
      {
        role: 'user',
        content: `${SUMMARIZATION_PROMPT}\n${JSON.stringify(messages, null, 2)}`
      }
    ],
    maxRetries: 2,
  });
  
  return result.text;
}

/**
 * Chunk text into smaller pieces for processing
 */
function chunkText(text: string, maxChunkSize: number = 300000): string[] {
  // Roughly 75k tokens per chunk (300k chars / 4)
  const chunks: string[] = [];
  
  for (let i = 0; i < text.length; i += maxChunkSize) {
    chunks.push(text.substring(i, i + maxChunkSize));
  }
  
  return chunks;
}

/**
 * Summarize a single large message
 * Handles messages that exceed Claude's context window by chunking
 */
export async function summarizeLargeMessage(
  message: CoreMessage,
  anthropicApiKey: string,
  modelId: string = 'claude-sonnet-4-20250514'
): Promise<string> {
  const anthropic = createAnthropic({ apiKey: anthropicApiKey });
  
  // Convert message to text
  const messageText = JSON.stringify(message, null, 2);
  const messageTokens = Math.ceil(messageText.length / 4);
  
  // If message fits in Claude's window (with room for prompt), summarize directly
  if (messageTokens < 150000) {
    const result = await generateText({
      model: anthropic(modelId),
      messages: [
        {
          role: 'user',
          content: `This single message is too large. Extract and summarize the key information:\n\n${SUMMARIZATION_PROMPT}\n${messageText}`
        }
      ],
      maxRetries: 2,
    });
    
    return result.text;
  }
  
  // Message is too large - chunk it and summarize each chunk, then combine
  console.log(`📦 [InfiniteMemory] Message too large for direct summarization (${messageTokens.toLocaleString()} tokens), chunking...`);
  
  const chunks = chunkText(messageText, 300000); // ~75k tokens per chunk
  console.log(`📦 [InfiniteMemory] Split into ${chunks.length} chunks, summarizing in parallel...`);
  
  const startTime = Date.now();
  
  // Summarize all chunks in parallel for speed
  const chunkSummaries = await Promise.all(
    chunks.map((chunk, i) => {
      console.log(`📝 [InfiniteMemory] Summarizing chunk ${i + 1}/${chunks.length}...`);
      
      return generateText({
        model: anthropic(modelId),
        messages: [
          {
            role: 'user',
            content: `Summarize this section (chunk ${i + 1}/${chunks.length}) of a large message:\n\n${SUMMARIZATION_PROMPT}\n${chunk}`
          }
        ],
        maxRetries: 2,
      }).then(result => result.text);
    })
  );
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ [InfiniteMemory] Summarized ${chunks.length} chunks in parallel (${duration}s)`);
  
  // If we have multiple chunk summaries, combine them into a final summary
  if (chunkSummaries.length > 1) {
    console.log(`🔗 [InfiniteMemory] Combining ${chunkSummaries.length} chunk summaries...`);
    
    const combinedResult = await generateText({
      model: anthropic(modelId),
      messages: [
        {
          role: 'user',
          content: `Combine these ${chunkSummaries.length} section summaries into one coherent summary:\n\n${chunkSummaries.map((s, i) => `SECTION ${i + 1}:\n${s}`).join('\n\n')}`
        }
      ],
      maxRetries: 2,
    });
    
    return combinedResult.text;
  }
  
  return chunkSummaries[0];
}

