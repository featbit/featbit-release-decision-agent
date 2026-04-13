#!/usr/bin/env node

/**
 * FeatBit Deployment Test Suite
 * Tests all three critical endpoints after deployment
 */

const https = require('https');

function testEndpoint(url, name) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    https
      .get(url, (res) => {
        const endTime = Date.now();
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          const elapsed = endTime - startTime;
          const status = res.statusCode;
          
          console.log('');
          console.log(`✅ ${name}`);
          console.log(`   URL: ${url}`);
          console.log(`   Status: ${status} (${status === 200 ? '✅ OK' : '❌ ERROR'})`);
          console.log(`   Response Time: ${elapsed}ms`);
          
          try {
            const parsed = JSON.parse(data);
            console.log(`   Response: ${JSON.stringify(parsed).substring(0, 100)}${JSON.stringify(parsed).length > 100 ? '...' : ''}`);
          } catch (e) {
            console.log(`   Response: ${data.substring(0, 100)}`);
          }

          resolve(status === 200);
        });
      })
      .on('error', (err) => {
        console.log('');
        console.log(`❌ ${name}`);
        console.log(`   URL: ${url}`);
        console.log(`   Error: ${err.message}`);
        resolve(false);
      });
  });
}

async function runTests() {
  console.log('🧪 FeatBit Release Decision Agent - Deployment Test');
  console.log('====================================================');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('');

  const tests = [
    {
      name: '1️⃣  Web Service (Projects)',
      url: 'https://www.featbit.ai/api/projects'
    },
    {
      name: '2️⃣  Experiments Running Endpoint',
      url: 'https://www.featbit.ai/api/experiments/running'
    },
    {
      name: '3️⃣  TSDB Stats Endpoint',
      url: 'https://tsdb.featbit.ai/api/stats'
    }
  ];

  const results = [];
  for (const test of tests) {
    const result = await testEndpoint(test.url, test.name);
    results.push({ test: test.name, passed: result });
  }

  console.log('');
  console.log('====================================================');
  console.log('📊 Test Summary');
  console.log('====================================================');

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((r) => {
    console.log(`${r.passed ? '✅' : '❌'} ${r.test}`);
  });

  console.log('');
  console.log(`Result: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('');
    console.log('🎉 All services are deployed and responding!');
    console.log('');
    console.log('📋 Next steps:');
    console.log('   1. Verify PostgreSQL connection (if needed)');
    console.log('   2. Create a test project via dashboard');
    console.log('   3. Set up experiments and flags');
    console.log('   4. Monitor first cron run in ~3 hours');
    process.exit(0);
  } else {
    console.log('');
    console.log('⚠️  Some tests failed. Check DEPLOY.md troubleshooting section.');
    process.exit(1);
  }
}

runTests();
