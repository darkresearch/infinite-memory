/**
 * Tag Filtering Test for CI
 * 
 * Verifies that OpenMemory tag filtering is EXACT (not semantic).
 * 
 * Tests:
 * 1. Store message A with messageId-A
 * 2. Store message B with messageId-B
 * 3. Query for messageId-A only
 * 4. Verify only message A is returned (message B excluded)
 * 
 * This validates:
 * - Tag filtering is explicit, not semantic
 * - MessageId filtering works correctly for preventing re-processing
 * - Conversation isolation will work correctly via tags
 */

import { createInfiniteMemory } from '../dist/index.js';

async function testTagFiltering() {
  console.log('🧪 Testing Tag Filtering Behavior\n');
  
  const memory = createInfiniteMemory({
    openMemoryUrl: process.env.OPENMEMORY_URL || 'http://localhost:8080',
    openMemoryApiKey: process.env.OPENMEMORY_API_KEY,
    anthropicApiKey: 'not-needed-for-this-test',
    openMemoryTimeout: 5000,
  });
  
  const userId = `test-user-${Date.now()}`;
  const msgIdA = `msg-a-${Date.now()}`;
  const msgIdB = `msg-b-${Date.now()}`;
  const convIdA = `conv-a-${Date.now()}`;
  const convIdB = `conv-b-${Date.now()}`;
  
  console.log(`📝 Storing message A with ID: ${msgIdA}`);
  await memory.storeMessage(convIdA, userId, 'user', 'Message A content', msgIdA);
  
  console.log(`📝 Storing message B with ID: ${msgIdB}`);
  await memory.storeMessage(convIdB, userId, 'user', 'Message B content', msgIdB);
  
  console.log('⏳ Waiting 2s for indexing...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Query for message A by tag - should NOT return message B
  console.log(`🔍 Querying for message A by tag (${msgIdA})...`);
  
  // Access internal client for testing
  const client = memory.openMemory;
  if (!client || typeof client.checkMessagesExist !== 'function') {
    console.error('❌ Cannot access checkMessagesExist method');
    process.exit(1);
  }
  
  const foundIds = await client.checkMessagesExist(userId, [msgIdA]);
  
  console.log(`\n📊 Results:`);
  console.log(`   - Looking for: ${msgIdA}`);
  console.log(`   - Found IDs: ${Array.from(foundIds).join(', ')}`);
  console.log(`   - Message A found: ${foundIds.has(msgIdA)}`);
  console.log(`   - Message B found: ${foundIds.has(msgIdB)}`);
  
  if (foundIds.has(msgIdA) && !foundIds.has(msgIdB)) {
    console.log('\n✅ PASS: Tag filtering is EXACT - only messageId-A returned');
    console.log('✅ This confirms that tag filtering works for:');
    console.log('   - Preventing re-processing of large messages');
    console.log('   - Conversation isolation via tags');
    process.exit(0);
  } else if (!foundIds.has(msgIdA)) {
    console.error('\n❌ FAIL: Message A not found - tag filtering not working');
    process.exit(1);
  } else if (foundIds.has(msgIdB)) {
    console.error('\n❌ FAIL: Message B was returned - tag filtering is SEMANTIC (not exact)');
    console.error('⚠️  This means conversation isolation may leak across conversations!');
    process.exit(1);
  } else {
    console.error('\n❌ FAIL: Unexpected result');
    process.exit(1);
  }
}

testTagFiltering().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});

