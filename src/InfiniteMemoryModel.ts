/**
 * Model wrapper that intercepts generate/stream calls for infinite memory
 */

import type { LanguageModel } from 'ai';
import { ContextManager } from './ContextManager.js';
import type { ModelContext } from './types.js';
import { generateMessageId } from './utils/messageFormatter.js';

/**
 * Wrapper around a LanguageModel that adds infinite memory capabilities
 */
export class InfiniteMemoryModel {
  readonly specificationVersion = 'v2' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly defaultObjectGenerationMode = 'tool' as const;
  readonly supportsImageUrls?: boolean;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(
    private baseModel: LanguageModel,
    private contextManager: ContextManager,
    private context: ModelContext,
    private modelIdString: string
  ) {
    // Access base model properties safely
    this.provider = (baseModel as any).provider || 'anthropic';
    this.modelId = (baseModel as any).modelId || modelIdString;
    this.supportsImageUrls = (baseModel as any).supportsImageUrls;
  }

  /**
   * Intercept doGenerate to add memory retrieval and storage
   */
  async doGenerate(
    options: any
  ): Promise<any> {
    // Get relevant context (recent + retrieved from OpenMemory)
    const contextResult = await this.contextManager.getRelevantContext(
      this.context,
      options.prompt,
      this.modelIdString
    );

    console.log(
      `🧠 [InfiniteMemory] Using ${contextResult.messages.length} messages (${contextResult.metadata.estimatedTokens.toLocaleString()} tokens)`
    );

    // Call base model with augmented context
    const result = await (this.baseModel as any).doGenerate({
      ...options,
      prompt: contextResult.messages,
    });

    // Store assistant response after generation
    if (result.text) {
      const assistantMessageId = generateMessageId();
      await this.contextManager.storeMessage(
        this.context,
        'assistant',
        result.text,
        assistantMessageId
      );
    }

    return result;
  }

  /**
   * Intercept doStream to add memory retrieval and storage
   */
  async doStream(
    options: any
  ): Promise<any> {
    // Get relevant context (recent + retrieved from OpenMemory)
    const contextResult = await this.contextManager.getRelevantContext(
      this.context,
      options.prompt,
      this.modelIdString
    );

    console.log(
      `🧠 [InfiniteMemory] Streaming with ${contextResult.messages.length} messages (${contextResult.metadata.estimatedTokens.toLocaleString()} tokens)`
    );

    // Call base model with augmented context
    const result = await (this.baseModel as any).doStream({
      ...options,
      prompt: contextResult.messages,
    });

    // Wrap the stream to accumulate the assistant response
    const assistantMessageId = generateMessageId();
    const accumulatedParts: string[] = [];
    const accumulatedToolCalls: any[] = [];

    const wrappedStream = new ReadableStream<any>({
      start: async (controller) => {
        try {
          const reader = result.stream.getReader();

          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Store the complete assistant response
              if (accumulatedParts.length > 0 || accumulatedToolCalls.length > 0) {
                const content =
                  accumulatedToolCalls.length > 0
                    ? [
                        ...accumulatedParts.map((text) => ({
                          type: 'text' as const,
                          text,
                        })),
                        ...accumulatedToolCalls,
                      ]
                    : accumulatedParts.join('');

                await this.contextManager.storeMessage(
                  this.context,
                  'assistant',
                  content,
                  assistantMessageId
                );
              }

              controller.close();
              break;
            }

            // Accumulate text deltas
            if (value.type === 'text-delta') {
              accumulatedParts.push(value.textDelta);
            }

            // Accumulate tool calls
            if (value.type === 'tool-call') {
              accumulatedToolCalls.push({
                type: 'tool-call',
                toolCallId: value.toolCallId,
                toolName: value.toolName,
                args: value.args,
              });
            }

            // Forward the value to the consumer
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return {
      ...result,
      stream: wrappedStream,
    };
  }
}

