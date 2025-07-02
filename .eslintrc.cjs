module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    worker: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-console': 'warn',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '*.ts',
    '*.d.ts',
    'test/*.js',
    'convert-tests.js',
    'fix-tests.js',
    'fix-security-test.js',
  ],
  overrides: [
    {
      files: ['*.test.ts', '*.test.js'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
}; 