#!/usr/bin/env node

/**
 * FlowBalance Setup Script
 * Dead-simple setup for your load balancer
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('🚀 Welcome to FlowBalance Setup!\n');
  console.log('This will help you configure your load balancer in 2 minutes.\n');

  // Read existing wrangler config
  let wranglerConfig = {};
  if (existsSync('wrangler.jsonc')) {
    try {
      const content = readFileSync('wrangler.jsonc', 'utf-8');
      // Simple JSON parsing (removes comments)
      const cleanJson = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      wranglerConfig = JSON.parse(cleanJson);
    } catch (e) {
      console.log('📝 Creating new wrangler.jsonc...');
    }
  }

  // Ensure basic structure
  if (!wranglerConfig.vars) wranglerConfig.vars = {};

  // Ask for basic configuration
  console.log('Step 1: Basic Configuration');
  console.log('───────────────────────────');

  const hostname = await askQuestion('🌐 What domain will you load balance? (e.g., api.myapp.com): ');
  if (!hostname) {
    console.log('❌ Domain is required. Exiting...');
    process.exit(1);
  }

  const backendsInput = await askQuestion('🖥️  Enter your backend servers (comma-separated URLs):\n   Example: https://server1.com,https://server2.com\n   Backends: ');
  
  if (!backendsInput) {
    console.log('❌ At least one backend is required. Exiting...');
    process.exit(1);
  }

  const backends = backendsInput.split(',').map(url => url.trim()).filter(url => url);

  // Build DEFAULT_BACKENDS config
  const backendConfig = {
    hostname: hostname,
    backends: backends
  };

  wranglerConfig.vars.DEFAULT_BACKENDS = JSON.stringify(backendConfig);

  console.log('\nStep 2: Authentication (Optional)');
  console.log('─────────────────────────────────');
  console.log('You can set up OAuth later. Using defaults for now...\n');

  // Set sensible defaults
  if (!wranglerConfig.vars.JWT_SECRET) {
    wranglerConfig.vars.JWT_SECRET = generateRandomSecret();
  }
  if (!wranglerConfig.vars.API_SECRET) {
    wranglerConfig.vars.API_SECRET = generateRandomSecret();
  }
  
  // Optional OAuth setup
  const setupOAuth = await askQuestion('🔐 Set up GitHub OAuth now? (y/N): ');
  if (setupOAuth.toLowerCase() === 'y') {
    const githubClientId = await askQuestion('   GitHub Client ID: ');
    const githubClientSecret = await askQuestion('   GitHub Client Secret: ');
    const authorizedUsers = await askQuestion('   Authorized email addresses (comma-separated): ');

    if (githubClientId) wranglerConfig.vars.GITHUB_CLIENT_ID = githubClientId;
    if (githubClientSecret) wranglerConfig.vars.GITHUB_CLIENT_SECRET = githubClientSecret;
    if (authorizedUsers) wranglerConfig.vars.AUTHORIZED_USERS = authorizedUsers;
  }

  // Ensure required structure
  if (!wranglerConfig.name) wranglerConfig.name = 'flowbalance';
  if (!wranglerConfig.main) wranglerConfig.main = 'src/index.ts';
  if (!wranglerConfig.compatibility_date) wranglerConfig.compatibility_date = '2025-01-01';

  // Write updated config
  const configContent = JSON.stringify(wranglerConfig, null, 2);
  writeFileSync('wrangler.jsonc', configContent);

  console.log('\n✅ Configuration saved to wrangler.jsonc');
  console.log('\nStep 3: Deploy');
  console.log('──────────────');
  console.log('Run these commands to deploy:');
  console.log('');
  console.log('  npm run deploy');
  console.log('');
  console.log('🎉 That\'s it! Your load balancer will be live at:');
  console.log(`   https://flowbalance.your-subdomain.workers.dev`);
  console.log('');
  console.log('📊 Access the dashboard at:');
  console.log(`   https://flowbalance.your-subdomain.workers.dev/__lb_admin__`);
  console.log('');
  console.log('💡 Need help? Check the README.md or visit our docs!');

  rl.close();
}

function generateRandomSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Handle errors gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Setup cancelled. Run npm run setup to try again.');
  process.exit(0);
});

main().catch(error => {
  console.error('❌ Setup failed:', error.message);
  process.exit(1);
}); 