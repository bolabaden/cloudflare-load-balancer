# Comprehensive Testing Guide for FlowBalance

This document provides a complete guide to the testing infrastructure for FlowBalance, including GitHub Actions workflows, test categories, and execution strategies.

## Overview

FlowBalance uses a multi-layered testing approach that ensures comprehensive coverage without mocking, providing real-world testing scenarios for the Cloudflare Workers load balancer.

## Testing Architecture

### 1. Test Categories

#### Unit Tests
- **Configuration Tests** (`test:config`): Validate configuration parsing and defaults
- **Authentication Tests** (`test:auth`): Test OAuth flows and JWT handling
- **Types Tests**: Validate TypeScript type definitions and interfaces
- **Frontend Tests** (`test:frontend`): Test web interface components

#### Integration Tests
- **Basic Routing**: Load balancer request routing functionality
- **Health Checks**: Active and passive health monitoring
- **Failover**: Backend failure detection and traffic rerouting
- **Session Affinity**: Sticky session management
- **DNS Integration**: DNS failover capabilities
- **Metrics Collection**: Observability and monitoring data

#### Engine Tests
Tests for each load balancing algorithm:
- Round Robin
- Weighted Round Robin
- Least Connections
- Geographic Routing
- IP Hash
- Random

#### Durable Object Tests
- **State Management**: Persistent state handling
- **Configuration**: Dynamic configuration updates
- **Persistence**: Data durability across restarts
- **Concurrency**: Multi-instance coordination

#### Workers Runtime Tests
- **Fetch Handling**: HTTP request processing
- **Durable Objects**: DO integration and communication
- **KV Storage**: Key-value storage operations
- **Scheduled Events**: Cron job functionality
- **WebSockets**: Real-time communication

#### Vitest Tests
Cloudflare Workers-specific testing using `@cloudflare/vitest-pool-workers`:
- **Core Functionality**: Worker execution environment
- **Load Balancing**: Algorithm implementation
- **Health Monitoring**: Health check systems
- **Authentication**: OAuth and JWT in Workers context
- **API Endpoints**: Admin and monitoring APIs

#### Performance Tests
Load pattern testing:
- **Low Load**: Basic performance validation
- **Medium Load**: Normal operation stress testing
- **High Load**: Peak capacity testing
- **Burst Load**: Sudden traffic spike handling
- **Sustained Load**: Long-term stability testing

#### Security Tests
Security aspect validation:
- **Authentication**: Login security and token validation
- **Authorization**: Access control and permissions
- **Input Validation**: Request sanitization
- **Rate Limiting**: Traffic throttling
- **CSRF Protection**: Cross-site request forgery prevention
- **XSS Prevention**: Cross-site scripting protection

#### End-to-End Tests
Browser-based testing across multiple browsers (Chromium, Firefox):
- **User Authentication**: Complete login flows
- **Load Balancer Configuration**: Admin interface testing
- **Health Monitoring**: Dashboard functionality
- **Failover Scenarios**: Real-world failure simulation

#### Health Check Tests
Specific health monitoring validation:
- **HTTP Health Checks**: Standard HTTP endpoint monitoring
- **TCP Health Checks**: Low-level connectivity testing
- **DNS Health Checks**: DNS resolution validation
- **Custom Health Checks**: Application-specific monitoring

#### API Tests
Admin and monitoring API validation:
- **Admin API**: Administrative operations
- **Monitoring API**: Metrics and status endpoints
- **Configuration API**: Dynamic configuration management
- **Metrics API**: Performance and health data

### 2. GitHub Actions Workflows

#### Comprehensive Testing Workflow (`.github/workflows/test-comprehensive.yml`)

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests
- Daily scheduled runs (2 AM UTC)
- Manual workflow dispatch with test type selection

**Job Matrix Strategy:**
- Parallel execution for maximum efficiency
- Isolated test environments for each category
- Comprehensive artifact collection
- Detailed test result reporting

**Key Features:**
- **Test Isolation**: Each test category runs in its own environment
- **No Mocking**: Real backend servers and services for authentic testing
- **Granular Results**: Individual test artifacts for debugging
- **Comprehensive Coverage**: All aspects of the load balancer tested
- **Performance Monitoring**: Built-in performance thresholds
- **Security Validation**: Automated security testing

#### Deployment Workflow (`.github/workflows/deploy.yml`)

**Environments:**
- **Staging**: Automatic deployment on main branch pushes
- **Production**: Manual deployment with approval

**Safety Features:**
- Pre-deployment testing
- Smoke tests after deployment
- Automatic rollback on failure
- Environment-specific configurations

### 3. Test Configuration

#### Vitest Configuration (`vitest.config.ts`)

```typescript
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
          kvNamespaces: ['TEST_KV'],
          durableObjects: {
            'LOAD_BALANCER_DO': 'LoadBalancerDurableObject'
          },
          bindings: {
            // Test environment variables
          }
        }
      }
    },
    pool: 'workers',
    testTimeout: 30000,
    hookTimeout: 10000
  }
});
```

#### Test Backend Setup (`test/setup-test-backends.js`)

Mock backend servers for testing:
- **Healthy Backend** (Port 8081): Always responds successfully
- **Unhealthy Backend** (Port 8082): Always returns errors
- **Slow Backend** (Port 8083): Introduces latency
- **Intermittent Backend** (Port 8084): Alternates between healthy/unhealthy

### 4. Running Tests

#### Local Development

```bash
# Run all tests
npm run test:all

# Run specific test categories
npm run test:unit
npm run test:integration
npm run test:performance
npm run test:security

# Run Vitest tests
npm run test:vitest
npm run test:vitest:watch
npm run test:vitest:coverage

# Run individual test suites
npm run test:engine
npm run test:durable-object
npm run test:auth
npm run test:api
npm run test:health-checks
npm run test:frontend
npm run test:workers-runtime
npm run test:e2e
```

#### GitHub Actions

```bash
# Trigger comprehensive testing
gh workflow run test-comprehensive.yml

# Run specific test types
gh workflow run test-comprehensive.yml -f test_type=unit
gh workflow run test-comprehensive.yml -f test_type=integration
gh workflow run test-comprehensive.yml -f test_type=performance
gh workflow run test-comprehensive.yml -f test_type=security
gh workflow run test-comprehensive.yml -f test_type=vitest

# Deploy to staging
gh workflow run deploy.yml -f environment=staging

# Deploy to production
gh workflow run deploy.yml -f environment=production
```

### 5. Test Environment Variables

#### Required Secrets

```bash
# Cloudflare
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID

# Test Environment (Optional)
TEST_GITHUB_CLIENT_ID
TEST_GITHUB_CLIENT_SECRET
TEST_GOOGLE_CLIENT_ID
TEST_GOOGLE_CLIENT_SECRET
TEST_DNS_API_TOKEN
TEST_DNS_ZONE_ID
TEST_CLOUDFLARE_ACCOUNT_ID
TEST_CLOUDFLARE_API_TOKEN
```

#### Test Environment Variables

```bash
NODE_ENV=test
ENVIRONMENT=test
JWT_SECRET=test-jwt-secret-key-for-testing-purposes-only
ADMIN_EMAILS=test@example.com,admin@example.com
WEBHOOK_SECRET=test-webhook-secret
NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/test
DNS_PROVIDER=cloudflare
```

### 6. Test Artifacts and Results

#### Artifact Collection
- **Test Results**: JSON/XML test reports
- **Coverage Reports**: Code coverage analysis
- **Performance Metrics**: Latency and throughput data
- **Security Reports**: Vulnerability assessments
- **Screenshots**: E2E test visual evidence
- **Logs**: Detailed execution logs

#### Result Analysis
- **Test Summary**: Comprehensive test status report
- **PR Comments**: Automated test result comments on pull requests
- **Failure Analysis**: Detailed failure reports with stack traces
- **Performance Trends**: Historical performance data

### 7. Best Practices

#### Test Writing
1. **No Mocking**: Use real services and backends when possible
2. **Isolation**: Each test should be independent
3. **Cleanup**: Properly clean up test resources
4. **Timeouts**: Set appropriate timeouts for async operations
5. **Assertions**: Use descriptive assertion messages

#### Test Maintenance
1. **Regular Updates**: Keep test dependencies updated
2. **Performance Monitoring**: Monitor test execution times
3. **Flaky Test Detection**: Identify and fix unreliable tests
4. **Coverage Goals**: Maintain high test coverage
5. **Documentation**: Keep test documentation current

#### CI/CD Integration
1. **Fast Feedback**: Prioritize quick test execution
2. **Parallel Execution**: Maximize parallelization
3. **Resource Management**: Efficient use of CI resources
4. **Artifact Management**: Proper test artifact storage
5. **Notification**: Alert on test failures

### 8. Troubleshooting

#### Common Issues
1. **Test Timeouts**: Increase timeout values for slow operations
2. **Resource Conflicts**: Ensure proper test isolation
3. **Environment Issues**: Verify environment variable configuration
4. **Network Issues**: Check connectivity to external services
5. **Dependency Issues**: Ensure all dependencies are installed

#### Debug Strategies
1. **Local Reproduction**: Run tests locally first
2. **Verbose Logging**: Enable detailed logging for debugging
3. **Incremental Testing**: Test individual components
4. **Environment Comparison**: Compare local vs CI environments
5. **Artifact Analysis**: Review test artifacts for clues

### 9. Performance Considerations

#### Test Optimization
- **Parallel Execution**: Run independent tests simultaneously
- **Resource Caching**: Cache dependencies and build artifacts
- **Test Sharding**: Split large test suites across multiple runners
- **Selective Testing**: Run only relevant tests for changes
- **Resource Cleanup**: Properly dispose of test resources

#### Monitoring
- **Execution Time**: Track test execution duration
- **Resource Usage**: Monitor CPU and memory consumption
- **Success Rates**: Track test reliability metrics
- **Coverage Trends**: Monitor code coverage over time
- **Performance Benchmarks**: Establish performance baselines

This comprehensive testing infrastructure ensures FlowBalance maintains high quality, performance, and reliability across all components and deployment environments. 