import { defineConfig } from 'vitest/config';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          // Enable compatibility flags for testing
          compatibilityFlags: ['nodejs_compat'],
          // Use in-memory storage for testing
          kvNamespaces: ['TEST_KV'],
          durableObjects: {
            'LOAD_BALANCER_DO': 'LoadBalancerDurableObject'
          },
          // Environment variables for testing
          bindings: {
            ENVIRONMENT: 'test',
            GITHUB_CLIENT_ID: 'test-github-client-id',
            GITHUB_CLIENT_SECRET: 'test-github-client-secret',
            GOOGLE_CLIENT_ID: 'test-google-client-id',
            GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
            JWT_SECRET: 'test-jwt-secret-key-for-testing-purposes-only',
            ADMIN_EMAILS: 'test@example.com,admin@example.com',
            WEBHOOK_SECRET: 'test-webhook-secret',
            NOTIFICATION_WEBHOOK_URL: 'https://hooks.slack.com/test',
            DNS_PROVIDER: 'cloudflare',
            DNS_API_TOKEN: 'test-dns-token',
            DNS_ZONE_ID: 'test-zone-id'
          }
        }
      }
    },
    // Test timeout for complex operations
    testTimeout: 30000,
    // Hook timeout for setup/teardown
    hookTimeout: 10000,
    // Run tests in sequence to avoid conflicts
    pool: 'workers',
    // Test file patterns
    include: [
      'test/**/*.test.{js,ts}',
      'src/**/*.test.{js,ts}'
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      '.wrangler/**'
    ],
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'test/**',
        '**/*.test.{js,ts}',
        '**/*.d.ts',
        'dist/**',
        '.wrangler/**'
      ]
    }
  },
  // TypeScript configuration
  esbuild: {
    target: 'es2022'
  }
}); 