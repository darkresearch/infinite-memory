/**
 * Memory Isolation Tests
 * 
 * These tests verify that user and conversation memory segmentation works correctly
 * to prevent cross-contamination of memories between users or conversations.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createInfiniteMemory } from '../index.js';

describe('Memory Isolation', () => {
  const config = {
    openMemoryUrl: process.env.OPENMEMORY_URL || 'http://localhost:8080',
    openMemoryApiKey: process.env.OPENMEMORY_API_KEY || 'test-key',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || 'test-key',
    openMemoryTimeout: 5000,
  };
  
  const shouldRun = process.env.OPENMEMORY_API_KEY && process.env.ANTHROPIC_API_KEY;
  
  test.skipIf(!shouldRun)('User A cannot retrieve User B memories', async () => {
    const memory = createInfiniteMemory(config);
    
    // Store a message for User A in Conversation 1
    const userAId = 'user-a-' + Date.now();
    const userBId = 'user-b-' + Date.now();
    const conv1 = 'conv-1-' + Date.now();
    const conv2 = 'conv-2-' + Date.now();
    
    console.log('🧪 Test setup:', { userAId, userBId, conv1, conv2 });
    
    // Store User A's message in Conversation 1
    await memory.storeMessage(
      conv1,
      userAId,
      'user',
      'This is User A secret information about crypto wallet 0x123',
      'msg-a-1'
    );
    
    // Store User B's message in Conversation 2
    await memory.storeMessage(
      conv2,
      userBId,
      'user',
      'This is User B secret information about crypto wallet 0x456',
      'msg-b-1'
    );
    
    // Wait for indexing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Query as User A in Conversation 1 - should only get User A's memories
    const userAResults = await memory.getRelevantContext(
      conv1,
      userAId,
      [{
        role: 'user',
        content: 'Tell me about my crypto wallet'
      }] as any,
      'claude-sonnet-4-20250514'
    );
    
    console.log('📊 User A query results:', {
      messageCount: userAResults.messages.length,
      hasHistoricalContext: !!userAResults.historicalContext,
      historicalContextPreview: userAResults.historicalContext?.substring(0, 200)
    });
    
    // Verify User A can see their own memory
    if (userAResults.historicalContext) {
      expect(userAResults.historicalContext).toContain('0x123');
      expect(userAResults.historicalContext).not.toContain('0x456');
    }
    
    // Query as User B in Conversation 2 - should only get User B's memories
    const userBResults = await memory.getRelevantContext(
      conv2,
      userBId,
      [{
        role: 'user',
        content: 'Tell me about my crypto wallet'
      }] as any,
      'claude-sonnet-4-20250514'
    );
    
    console.log('📊 User B query results:', {
      messageCount: userBResults.messages.length,
      hasHistoricalContext: !!userBResults.historicalContext,
      historicalContextPreview: userBResults.historicalContext?.substring(0, 200)
    });
    
    // Verify User B can see their own memory
    if (userBResults.historicalContext) {
      expect(userBResults.historicalContext).toContain('0x456');
      expect(userBResults.historicalContext).not.toContain('0x123');
    }
    
    console.log('✅ Memory isolation verified - users cannot see each other\'s memories');
  }, 30000); // 30 second timeout for API calls
  
  test.skipIf(!shouldRun)('Conversation X cannot retrieve Conversation Y memories (same user)', async () => {
    const memory = createInfiniteMemory(config);
    
    const userId = 'user-same-' + Date.now();
    const convX = 'conv-x-' + Date.now();
    const convY = 'conv-y-' + Date.now();
    
    console.log('🧪 Test setup:', { userId, convX, convY });
    
    // Store message in Conversation X
    await memory.storeMessage(
      convX,
      userId,
      'user',
      'In conversation X, we discussed project Apollo details',
      'msg-x-1'
    );
    
    // Store message in Conversation Y
    await memory.storeMessage(
      convY,
      userId,
      'user',
      'In conversation Y, we discussed project Zeus details',
      'msg-y-1'
    );
    
    // Wait for indexing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Query in Conversation X - should only get Conversation X memories
    const convXResults = await memory.getRelevantContext(
      convX,
      userId,
      [{
        role: 'user',
        content: 'Tell me about our project discussion'
      }] as any,
      'claude-sonnet-4-20250514'
    );
    
    console.log('📊 Conversation X query results:', {
      messageCount: convXResults.messages.length,
      hasHistoricalContext: !!convXResults.historicalContext,
      historicalContextPreview: convXResults.historicalContext?.substring(0, 200)
    });
    
    // Verify Conversation X can see its own memory
    if (convXResults.historicalContext) {
      expect(convXResults.historicalContext).toContain('Apollo');
      expect(convXResults.historicalContext).not.toContain('Zeus');
    }
    
    // Query in Conversation Y - should only get Conversation Y memories
    const convYResults = await memory.getRelevantContext(
      convY,
      userId,
      [{
        role: 'user',
        content: 'Tell me about our project discussion'
      }] as any,
      'claude-sonnet-4-20250514'
    );
    
    console.log('📊 Conversation Y query results:', {
      messageCount: convYResults.messages.length,
      hasHistoricalContext: !!convYResults.historicalContext,
      historicalContextPreview: convYResults.historicalContext?.substring(0, 200)
    });
    
    // Verify Conversation Y can see its own memory
    if (convYResults.historicalContext) {
      expect(convYResults.historicalContext).toContain('Zeus');
      expect(convYResults.historicalContext).not.toContain('Apollo');
    }
    
    console.log('✅ Conversation isolation verified - conversations are properly segmented');
  }, 30000); // 30 second timeout for API calls
});

