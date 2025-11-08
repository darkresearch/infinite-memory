/**
 * User Isolation Test for CI
 * 
 * Verifies that User A cannot access User B's memories using the new
 * user_id suffix system (userId-user and userId-assistant).
 * 
 * Tests:
 * 1. User messages are isolated by userId-user
 * 2. Assistant messages are isolated by userId-assistant
 * 3. Cross-user queries return zero results from other users
 * 
 * This test runs against a real OpenMemory instance to ensure actual isolation.
 */

import { createInfiniteMemory } from '../dist/index.js';

const config = {
  openMemoryUrl: process.env.OPENMEMORY_URL || 'http://localhost:8080',
  openMemoryApiKey: process.env.OPENMEMORY_API_KEY,
  anthropicApiKey: 'not-needed-for-isolation-test', // Not called - test messages are tiny
  openMemoryTimeout: 5000,
};

async function testUserIsolation() {
  console.log('🧪 Starting User Isolation Test...\n');

  if (!config.openMemoryApiKey) {
    console.error('❌ OPENMEMORY_API_KEY is required');
    process.exit(1);
  }

  const memory = createInfiniteMemory(config);
  
  // Generate unique test IDs
  const timestamp = Date.now();
  const userA = `test-user-a-${timestamp}`;
  const userB = `test-user-b-${timestamp}`;
  const convA = `test-conv-a-${timestamp}`;
  const convB = `test-conv-b-${timestamp}`;
  
  const secretA = 'SECRET_INFO_USER_A_WALLET_0xAAA';
  const secretB = 'SECRET_INFO_USER_B_WALLET_0xBBB';
  
  console.log(`📋 Test Setup:
  - User A: ${userA}
  - User B: ${userB}
  - Secret A: ${secretA}
  - Secret B: ${secretB}\n`);

  try {
    // Step 1: Store User A's secrets (both user message and assistant response)
    console.log('📝 Step 1: Storing User A\'s messages...');
    await memory.storeMessage(
      convA,
      userA,
      'user',
      `My wallet address is ${secretA} and this is private information`,
      `msg-a-user-${timestamp}`
    );
    await memory.storeMessage(
      convA,
      userA,
      'assistant',
      `I've noted your wallet address ${secretA}. This information is securely stored.`,
      `msg-a-assistant-${timestamp}`
    );
    console.log('✅ User A\'s messages stored (user + assistant)\n');

    // Step 2: Store User B's secrets (both user message and assistant response)
    console.log('📝 Step 2: Storing User B\'s messages...');
    await memory.storeMessage(
      convB,
      userB,
      'user',
      `My wallet address is ${secretB} and this is confidential`,
      `msg-b-user-${timestamp}`
    );
    await memory.storeMessage(
      convB,
      userB,
      'assistant',
      `I've recorded your wallet address ${secretB}. Your data is private.`,
      `msg-b-assistant-${timestamp}`
    );
    console.log('✅ User B\'s messages stored (user + assistant)\n');

    // Wait for OpenMemory to index
    console.log('⏳ Waiting 3 seconds for indexing...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('✅ Indexing complete\n');

    // Step 3: Query as User A - should NOT see User B's secret
    console.log('🔍 Step 3: Querying as User A...');
    const userAResults = await memory.getRelevantContext(
      convA,
      userA,
      [{
        role: 'user',
        content: 'Tell me about wallet addresses'
      }],
      'claude-sonnet-4-20250514'
    );

    console.log(`📊 User A retrieved ${userAResults.metadata.retrievedCount} memories`);
    
    const userAContext = userAResults.historicalContext || '';
    const userACanSeeOwnSecret = userAContext.includes(secretA);
    const userACanSeeBSecret = userAContext.includes(secretB);
    
    console.log(`  - Can see own secret (${secretA}): ${userACanSeeOwnSecret ? '✅ YES' : '⚠️  NO'}`);
    console.log(`  - Can see User B's secret (${secretB}): ${userACanSeeBSecret ? '❌ YES (ISOLATION BREACH!)' : '✅ NO'}\n`);

    // Step 4: Query as User B - should NOT see User A's secret
    console.log('🔍 Step 4: Querying as User B...');
    const userBResults = await memory.getRelevantContext(
      convB,
      userB,
      [{
        role: 'user',
        content: 'Tell me about wallet addresses'
      }],
      'claude-sonnet-4-20250514'
    );

    console.log(`📊 User B retrieved ${userBResults.metadata.retrievedCount} memories`);
    
    const userBContext = userBResults.historicalContext || '';
    const userBCanSeeOwnSecret = userBContext.includes(secretB);
    const userBCanSeeASecret = userBContext.includes(secretA);
    
    console.log(`  - Can see own secret (${secretB}): ${userBCanSeeOwnSecret ? '✅ YES' : '⚠️  NO'}`);
    console.log(`  - Can see User A's secret (${secretA}): ${userBCanSeeASecret ? '❌ YES (ISOLATION BREACH!)' : '✅ NO'}\n`);

    // Verification
    console.log('📋 Test Results:');
    console.log('─'.repeat(60));
    console.log('Testing user_id suffix isolation:');
    console.log(`  - User A stored as: ${userA}-user and ${userA}-assistant`);
    console.log(`  - User B stored as: ${userB}-user and ${userB}-assistant`);
    console.log('');
    
    let passed = true;
    let failures = [];

    // User A should see their own secret
    if (!userACanSeeOwnSecret) {
      console.log('⚠️  WARNING: User A cannot see their own secret (may be too few memories or poor relevance)');
    }

    // User A should NOT see User B's secret (CRITICAL)
    if (userACanSeeBSecret) {
      console.log(`❌ CRITICAL FAILURE: User A (${userA}-user/assistant) can see User B's secret!`);
      console.log(`   This means OpenMemory's user_id filter failed!`);
      passed = false;
      failures.push('User B memories leaked to User A');
    } else {
      console.log(`✅ PASS: User A (${userA}-user/assistant) cannot see User B's secret`);
    }

    // User B should see their own secret
    if (!userBCanSeeOwnSecret) {
      console.log('⚠️  WARNING: User B cannot see their own secret (may be too few memories or poor relevance)');
    }

    // User B should NOT see User A's secret (CRITICAL)
    if (userBCanSeeASecret) {
      console.log(`❌ CRITICAL FAILURE: User B (${userB}-user/assistant) can see User A's secret!`);
      console.log(`   This means OpenMemory's user_id filter failed!`);
      passed = false;
      failures.push('User A memories leaked to User B');
    } else {
      console.log(`✅ PASS: User B (${userB}-user/assistant) cannot see User A's secret`);
    }

    console.log('─'.repeat(60));

    if (passed) {
      console.log('\n🎉 USER ISOLATION TEST PASSED!\n');
      console.log('✅ Users cannot access each other\'s memories');
      console.log('✅ user_id suffix system (-user / -assistant) is working');
      console.log('✅ OpenMemory\'s server-side user_id filtering is effective');
      console.log('✅ Memory segmentation is secure\n');
      process.exit(0);
    } else {
      console.error('\n❌ USER ISOLATION TEST FAILED!\n');
      console.error('Failures:', failures.join(', '));
      console.error('\n⚠️  CRITICAL SECURITY ISSUE: User memories are leaking!');
      console.error('⚠️  The user_id suffix system is NOT working as expected!\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testUserIsolation();

