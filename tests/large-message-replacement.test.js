/**
 * Large Message Replacement Test
 * 
 * Verifies that large messages (>50k tokens) that have been stored
 * are replaced with memory placeholders on subsequent turns.
 * 
 * Tests:
 * 1. Store a large message (>50k tokens)
 * 2. Request context with that same large message
 * 3. Verify the large message is replaced with a placeholder
 * 4. Verify the placeholder contains the message ID and preview
 * 5. Verify small messages (<50k tokens) are NOT replaced
 * 
 * This prevents "prompt too long" errors on follow-up messages.
 */

import { createInfiniteMemory } from '../dist/index.js';

async function testLargeMessageReplacement() {
  console.log('🧪 Testing Large Message Replacement\n');
  
  const memory = createInfiniteMemory({
    openMemoryUrl: process.env.OPENMEMORY_URL || 'http://localhost:8080',
    openMemoryApiKey: process.env.OPENMEMORY_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || 'test-key',
    openMemoryTimeout: 10000, // Longer timeout for large messages
  });
  
  const userId = `test-user-${Date.now()}`;
  const conversationId = `conv-${Date.now()}`;
  const largeMessageId = `large-msg-${Date.now()}`;
  const smallMessageId = `small-msg-${Date.now()}`;
  
  // Create a large message (>50k tokens ~= >200k chars)
  const largeContent = 'A'.repeat(250000); // ~250k chars = ~62.5k tokens
  console.log(`📝 Creating large message: ${largeContent.length} chars (~${Math.ceil(largeContent.length / 4)} tokens)`);
  
  // Create a small message
  const smallContent = 'This is a small message';
  console.log(`📝 Creating small message: ${smallContent.length} chars\n`);
  
  // Step 1: Store the large message
  console.log('Step 1: Storing large message...');
  await memory.storeMessage(conversationId, userId, 'user', largeContent, largeMessageId);
  console.log('✅ Large message stored\n');
  
  // Wait for indexing
  console.log('⏳ Waiting 3s for indexing...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Step 2: Also store the small message
  console.log('Step 2: Storing small message...');
  await memory.storeMessage(conversationId, userId, 'user', smallContent, smallMessageId);
  console.log('✅ Small message stored\n');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Step 3: Request context with both messages (simulating a follow-up turn)
  console.log('Step 3: Requesting context with both messages...');
  const messages = [
    { 
      role: 'user', 
      content: largeContent,
      id: largeMessageId 
    },
    { 
      role: 'user', 
      content: smallContent,
      id: smallMessageId 
    },
  ];
  
  const result = await memory.getRelevantContext(
    conversationId,
    userId,
    messages,
    'claude-sonnet-4-20250514'
  );
  
  console.log('\n📊 Results:');
  console.log(`   - Messages returned: ${result.messages.length}`);
  
  // Step 4: Verify the large message was replaced
  const processedLargeMessage = result.messages.find(m => m.id === largeMessageId);
  const processedSmallMessage = result.messages.find(m => m.id === smallMessageId);
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Large message should be replaced with placeholder
  console.log('\n🧪 Test 1: Large message replaced with placeholder');
  if (processedLargeMessage && 
      typeof processedLargeMessage.content === 'string' && 
      processedLargeMessage.content.includes('<LARGE_MESSAGE_IN_MEMORY')) {
    console.log('   ✅ PASS - Large message replaced with placeholder');
    testsPassed++;
  } else {
    console.error('   ❌ FAIL - Large message not replaced');
    console.error('   Content:', processedLargeMessage?.content?.substring(0, 100));
    testsFailed++;
  }
  
  // Test 2: Placeholder should contain message ID
  console.log('\n🧪 Test 2: Placeholder contains message ID');
  if (processedLargeMessage?.content?.includes(`id="${largeMessageId}"`)) {
    console.log('   ✅ PASS - Placeholder contains message ID');
    testsPassed++;
  } else {
    console.error('   ❌ FAIL - Message ID not in placeholder');
    testsFailed++;
  }
  
  // Test 3: Placeholder should contain preview
  console.log('\n🧪 Test 3: Placeholder contains preview text');
  if (processedLargeMessage?.content?.includes('Preview:')) {
    console.log('   ✅ PASS - Placeholder contains preview');
    testsPassed++;
  } else {
    console.error('   ❌ FAIL - No preview in placeholder');
    testsFailed++;
  }
  
  // Test 4: Small message should NOT be replaced
  console.log('\n🧪 Test 4: Small message NOT replaced');
  if (processedSmallMessage && 
      processedSmallMessage.content === smallContent) {
    console.log('   ✅ PASS - Small message unchanged');
    testsPassed++;
  } else {
    console.error('   ❌ FAIL - Small message was modified');
    console.error('   Expected:', smallContent);
    console.error('   Got:', processedSmallMessage?.content);
    testsFailed++;
  }
  
  // Test 5: Placeholder should inform Claude to search memory
  console.log('\n🧪 Test 5: Placeholder instructs memory search');
  if (processedLargeMessage?.content?.includes('long-term memory')) {
    console.log('   ✅ PASS - Placeholder mentions long-term memory');
    testsPassed++;
  } else {
    console.error('   ❌ FAIL - No memory search instruction');
    testsFailed++;
  }
  
  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log(`📊 Test Summary: ${testsPassed}/${testsPassed + testsFailed} passed`);
  console.log('═'.repeat(80));
  
  if (testsFailed === 0) {
    console.log('✅ All tests passed! Large message replacement works correctly.');
    console.log('\nBenefits validated:');
    console.log('   - Prevents "prompt too long" errors on follow-up messages');
    console.log('   - Large messages are automatically replaced with placeholders');
    console.log('   - Small messages pass through unchanged');
    console.log('   - Claude is informed to search its memory for details');
    process.exit(0);
  } else {
    console.error(`\n❌ ${testsFailed} test(s) failed`);
    process.exit(1);
  }
}

testLargeMessageReplacement().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});

