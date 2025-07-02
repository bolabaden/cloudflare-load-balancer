#!/usr/bin/env node

/**
 * FlowBalance Testing Environment Setup
 * Prepares the testing environment and validates configuration
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

console.log('🔧 Setting up FlowBalance testing environment...\n');

// Create test directories
const testDirs = [
  'test-results',
  'coverage',
  'performance-results',
  'security-results',
  'e2e-results',
  'health-check-results',
  'api-test-results',
  'screenshots',
  'videos',
  'metrics',
  'profiles',
  'vulnerability-reports',
  'backend-logs',
  'request-logs'
];

console.log('📁 Creating test directories...');
testDirs.forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`  ✅ Created ${dir}/`);
  } else {
    console.log(`  ⏭️  ${dir}/ already exists`);
  }
});

// Install dependencies
console.log('\n📦 Installing dependencies...');
try {
  execSync('npm ci', { stdio: 'inherit' });
  console.log('  ✅ Dependencies installed successfully');
} catch (error) {
  console.error('  ❌ Failed to install dependencies:', error.message);
  process.exit(1);
}

// Check TypeScript compilation
console.log('\n🔍 Checking TypeScript compilation...');
try {
  execSync('npm run typecheck', { stdio: 'inherit' });
  console.log('  ✅ TypeScript compilation successful');
} catch (error) {
  console.error('  ❌ TypeScript compilation failed:', error.message);
  process.exit(1);
}

// Check linting
console.log('\n🎨 Running linter...');
try {
  execSync('npm run lint', { stdio: 'inherit' });
  console.log('  ✅ Linting passed');
} catch (error) {
  console.warn('  ⚠️  Linting issues found, but continuing...');
}

// Build static assets
console.log('\n🏗️  Building static assets...');
try {
  execSync('npm run build:static', { stdio: 'inherit' });
  console.log('  ✅ Static assets built successfully');
} catch (error) {
  console.error('  ❌ Failed to build static assets:', error.message);
  process.exit(1);
}

// Create test environment file
console.log('\n⚙️  Creating test environment configuration...');
const testEnvContent = `# FlowBalance Test Environment Configuration
NODE_ENV=test
ENVIRONMENT=test

# Test Authentication
GITHUB_CLIENT_ID=test-github-client-id
GITHUB_CLIENT_SECRET=test-github-client-secret
GOOGLE_CLIENT_ID=test-google-client-id
GOOGLE_CLIENT_SECRET=test-google-client-secret
JWT_SECRET=test-jwt-secret-key-for-testing-purposes-only

# Test Admin Configuration
ADMIN_EMAILS=test@example.com,admin@example.com

# Test Webhooks
WEBHOOK_SECRET=test-webhook-secret
NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/test

# Test DNS Configuration
DNS_PROVIDER=cloudflare
DNS_API_TOKEN=test-dns-token
DNS_ZONE_ID=test-zone-id

# Test Cloudflare Configuration
CLOUDFLARE_ACCOUNT_ID=test-account-id
CLOUDFLARE_API_TOKEN=test-api-token

# Test Performance Thresholds
PERFORMANCE_THRESHOLD_MS=100
MEMORY_THRESHOLD_MB=128

# Test E2E Configuration
BASE_URL=http://localhost:8787
HEADLESS=true
`;

writeFileSync('.env.test', testEnvContent);
console.log('  ✅ Test environment file created (.env.test)');

// Validate test scripts
console.log('\n🧪 Validating test scripts...');
const testScripts = [
  'test:unit',
  'test:integration',
  'test:engine',
  'test:durable-object',
  'test:auth',
  'test:api',
  'test:health-checks',
  'test:frontend',
  'test:workers-runtime',
  'test:e2e',
  'test:security',
  'test:performance'
];

const packageJson = JSON.parse(require('fs').readFileSync('package.json', 'utf8'));
const missingScripts = testScripts.filter(script => !packageJson.scripts[script]);

if (missingScripts.length > 0) {
  console.warn('  ⚠️  Missing test scripts:', missingScripts.join(', '));
} else {
  console.log('  ✅ All test scripts are configured');
}

// Check for required files
console.log('\n📄 Checking required files...');
const requiredFiles = [
  'vitest.config.ts',
  'wrangler.jsonc',
  'tsconfig.json',
  '.github/workflows/test-comprehensive.yml',
  '.github/workflows/deploy.yml',
  'test/setup-test-backends.js'
];

const missingFiles = requiredFiles.filter(file => !existsSync(file));

if (missingFiles.length > 0) {
  console.warn('  ⚠️  Missing files:', missingFiles.join(', '));
} else {
  console.log('  ✅ All required files are present');
}

// Test backend server validation
console.log('\n🖥️  Testing backend server setup...');
try {
  // Import and test the setup script
  const { testBackends } = await import('./test/setup-test-backends.js');
  console.log('  ✅ Test backend configuration loaded');
  console.log('  📍 Backend URLs:', testBackends);
} catch (error) {
  console.error('  ❌ Failed to load test backend configuration:', error.message);
}

// GitHub Actions validation
console.log('\n🔄 GitHub Actions workflow validation...');
if (existsSync('.github/workflows/test-comprehensive.yml')) {
  console.log('  ✅ Comprehensive testing workflow configured');
} else {
  console.warn('  ⚠️  Comprehensive testing workflow missing');
}

if (existsSync('.github/workflows/deploy.yml')) {
  console.log('  ✅ Deployment workflow configured');
} else {
  console.warn('  ⚠️  Deployment workflow missing');
}

// Summary
console.log('\n📋 Setup Summary:');
console.log('='.repeat(50));
console.log('✅ Test directories created');
console.log('✅ Dependencies installed');
console.log('✅ TypeScript compilation verified');
console.log('✅ Static assets built');
console.log('✅ Test environment configured');

if (missingScripts.length === 0 && missingFiles.length === 0) {
  console.log('✅ All test scripts and files present');
  console.log('\n🎉 Testing environment setup complete!');
  console.log('\n📚 Next steps:');
  console.log('1. Review test configuration in vitest.config.ts');
  console.log('2. Configure GitHub repository secrets for CI/CD');
  console.log('3. Run tests locally: npm run test:all');
  console.log('4. Trigger GitHub Actions workflow for comprehensive testing');
  console.log('\n📖 For detailed information, see TESTING_COMPREHENSIVE.md');
} else {
  console.log('⚠️  Some configuration issues found');
  console.log('\n🔧 Manual steps required:');
  if (missingScripts.length > 0) {
    console.log('- Add missing test scripts to package.json');
  }
  if (missingFiles.length > 0) {
    console.log('- Create missing configuration files');
  }
  console.log('\n📖 See TESTING_COMPREHENSIVE.md for guidance');
}

console.log('\n' + '='.repeat(50)); 