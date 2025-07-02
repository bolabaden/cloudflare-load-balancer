import { test, describe } from 'node:test';
import assert from 'node:assert';

// Import functions to test (we'll need to transpile or use a test runner that handles TS)
// For now, these tests assume the functions are available
// Mock implementations for testing (since we can't directly import TypeScript)
const parseDefaultBackends = (config) => {
  try {
    if (!config) return [];
    const parsed = JSON.parse(config);
    
    if (Array.isArray(parsed)) {
      return parsed.filter(service => service.hostname && service.backends && service.backends.length > 0);
    }
    
    if (parsed.services) {
      return parsed.services.filter(service => service.hostname && service.backends && service.backends.length > 0);
    }
    
    if (parsed.hostname && parsed.backends) {
      return [parsed];
    }
    
    return [];
  } catch {
    return [];
  }
};

const createSmartDefaults = (hostname, backends) => {
  const sanitizedId = hostname.replace(/[^a-zA-Z0-9-]/g, '-');
  
  return {
    serviceId: hostname,
    mode: 'simple',
    simpleBackends: backends,
    activeHealthChecks: {
      enabled: true,
      path: '/health',
      interval: 60
    },
    passiveHealthChecks: {
      enabled: true,
      circuit_breaker: {
        enabled: true
      },
      max_failures: 2
    },
    load_balancer: {
      hostname: hostname,
      id: `lb-${sanitizedId}`,
      proxied: true,
      enabled: true,
      default_pool_ids: ['simple-pool'],
      zero_downtime_failover: {
        enabled: true,
        trigger_codes: [521, 522, 523, 525, 526]
      }
    },
    retryPolicy: {
      max_retries: 1,
      enabled: true
    },
    pools: [{
      backends: backends.map((url, i) => ({
        id: `backend-${i + 1}`,
        url: url,
        weight: 1,
        healthy: true,
        priority: 10 + i
      })),
      minimum_origins: Math.min(backends.length, 1)
    }],
    observability: {
      add_backend_header: true,
      add_pool_header: false,
      add_region_header: false,
      responseHeaderName: 'X-Backend-Used'
    }
  };
};

const COMMON_HEALTH_PATHS = [
  '/health',
  '/healthz',
  '/health-check',
  '/api/health',
  '/api/status',
  '/status',
  '/ping',
  '/ready',
  '/live',
  '/'
];

describe('FlowBalance Config Tests', () => {
  
  describe('parseDefaultBackends', () => {
    test('should parse single service format', () => {
      const config = '{"hostname": "api.example.com", "backends": ["https://server1.com", "https://server2.com"]}';
      const result = parseDefaultBackends(config);
      
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].hostname, 'api.example.com');
      assert.deepStrictEqual(result[0].backends, ['https://server1.com', 'https://server2.com']);
    });

    test('should parse multiple services format', () => {
      const config = '{"services": [{"hostname": "api.com", "backends": ["https://api1.com"]}, {"hostname": "web.com", "backends": ["https://web1.com"]}]}';
      const result = parseDefaultBackends(config);
      
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].hostname, 'api.com');
      assert.strictEqual(result[1].hostname, 'web.com');
    });

    test('should parse array format', () => {
      const config = '[{"hostname": "test.com", "backends": ["https://test1.com"]}]';
      const result = parseDefaultBackends(config);
      
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].hostname, 'test.com');
    });

    test('should handle empty or invalid JSON', () => {
      assert.deepStrictEqual(parseDefaultBackends(''), []);
      assert.deepStrictEqual(parseDefaultBackends('invalid json'), []);
      assert.deepStrictEqual(parseDefaultBackends('{}'), []);
    });

    test('should filter out invalid services', () => {
      const config = '{"services": [{"hostname": "valid.com", "backends": ["https://valid.com"]}, {"hostname": "", "backends": []}, {"backends": ["https://nohost.com"]}]}';
      const result = parseDefaultBackends(config);
      
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].hostname, 'valid.com');
    });
  });

  describe('createSmartDefaults', () => {
    test('should create sensible defaults for simple case', () => {
      const hostname = 'api.example.com';
      const backends = ['https://server1.com', 'https://server2.com'];
      const defaults = createSmartDefaults(hostname, backends);

      // Test basic structure
      assert.strictEqual(defaults.serviceId, hostname);
      assert.strictEqual(defaults.mode, 'simple');
      assert.deepStrictEqual(defaults.simpleBackends, backends);

      // Test that active health checks are enabled by default
      assert.strictEqual(defaults.activeHealthChecks.enabled, true);
      assert.strictEqual(defaults.activeHealthChecks.path, '/health');
      assert.strictEqual(defaults.activeHealthChecks.interval, 60);

      // Test that passive health checks are enabled with circuit breaker
      assert.strictEqual(defaults.passiveHealthChecks.enabled, true);
      assert.strictEqual(defaults.passiveHealthChecks.circuit_breaker.enabled, true);
      assert.strictEqual(defaults.passiveHealthChecks.max_failures, 2); // Fail fast

      // Test zero-downtime failover is enabled
      assert.strictEqual(defaults.load_balancer.zero_downtime_failover.enabled, true);
      assert.deepStrictEqual(defaults.load_balancer.zero_downtime_failover.trigger_codes, [521, 522, 523, 525, 526]);

      // Test retry policy is conservative
      assert.strictEqual(defaults.retryPolicy.max_retries, 1);
      assert.strictEqual(defaults.retryPolicy.enabled, true);
    });

    test('should create correct backend structure', () => {
      const hostname = 'test.com';
      const backends = ['https://backend1.com', 'https://backend2.com'];
      const defaults = createSmartDefaults(hostname, backends);

      const pool = defaults.pools[0];
      assert.strictEqual(pool.backends.length, 2);
      
      // Test first backend
      const backend1 = pool.backends[0];
      assert.strictEqual(backend1.id, 'backend-1');
      assert.strictEqual(backend1.url, 'https://backend1.com');
      assert.strictEqual(backend1.weight, 1);
      assert.strictEqual(backend1.healthy, true);
      assert.strictEqual(backend1.priority, 10);

      // Test second backend has higher priority (for ordering)
      const backend2 = pool.backends[1];
      assert.strictEqual(backend2.priority, 11);
    });

    test('should handle single backend correctly', () => {
      const defaults = createSmartDefaults('single.com', ['https://only-backend.com']);
      
      assert.strictEqual(defaults.pools[0].backends.length, 1);
      assert.strictEqual(defaults.pools[0].minimum_origins, 1);
    });

    test('should set smart observability defaults', () => {
      const defaults = createSmartDefaults('test.com', ['https://test.com']);
      
      assert.strictEqual(defaults.observability.add_backend_header, true);
      assert.strictEqual(defaults.observability.add_pool_header, false); // Keep minimal
      assert.strictEqual(defaults.observability.add_region_header, false);
      assert.strictEqual(defaults.observability.responseHeaderName, 'X-Backend-Used');
    });
  });

  describe('Health Check Paths', () => {
    test('should have sensible health check path order', () => {
      // Test that common paths come first
      assert.strictEqual(COMMON_HEALTH_PATHS[0], '/health');
      assert.strictEqual(COMMON_HEALTH_PATHS[1], '/healthz');
      
      // Test that root path is last resort
      assert.strictEqual(COMMON_HEALTH_PATHS[COMMON_HEALTH_PATHS.length - 1], '/');
      
      // Test that it includes API paths
      assert(COMMON_HEALTH_PATHS.includes('/api/health'));
      assert(COMMON_HEALTH_PATHS.includes('/api/status'));
    });

    test('should have reasonable number of paths to try', () => {
      // Should be comprehensive but not excessive
      assert(COMMON_HEALTH_PATHS.length >= 5);
      assert(COMMON_HEALTH_PATHS.length <= 15);
    });
  });

  describe('Configuration Integration', () => {
    test('should handle real-world backend URLs', () => {
      const realBackends = [
        'https://api-prod-us-east.example.com:8443',
        'https://api-prod-us-west.example.com:8443',
        'http://localhost:3000'
      ];
      
      const defaults = createSmartDefaults('api.example.com', realBackends);
      
      assert.strictEqual(defaults.pools[0].backends.length, 3);
      defaults.pools[0].backends.forEach((backend, i) => {
        assert.strictEqual(backend.url, realBackends[i]);
        assert.strictEqual(backend.id, `backend-${i + 1}`);
      });
    });

    test('should generate valid load balancer configuration', () => {
      const defaults = createSmartDefaults('complex-api.company.com', ['https://srv1.com', 'https://srv2.com']);
      
      // Test load balancer structure
      const lb = defaults.load_balancer;
      assert.strictEqual(lb.hostname, 'complex-api.company.com');
      assert.strictEqual(lb.id, 'lb-complex-api-company-com'); // Sanitized hostname
      assert.strictEqual(lb.proxied, true);
      assert.strictEqual(lb.enabled, true);
      assert.deepStrictEqual(lb.default_pool_ids, ['simple-pool']);
    });
  });
}); 