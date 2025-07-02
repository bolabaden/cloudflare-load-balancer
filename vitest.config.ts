import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test timeout for complex operations
    testTimeout: 30000,
    // Hook timeout for setup/teardown
    hookTimeout: 10000,
    // Test file patterns
    include: [
      'test/**/*.test.{js,ts}',
      'src/**/*.test.{js,ts}'
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      '.wrangler/**',
      'admin/**'
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
        '.wrangler/**',
        'admin/**'
      ]
    }
  },
  // TypeScript configuration
  esbuild: {
    target: 'es2022'
  }
}); 