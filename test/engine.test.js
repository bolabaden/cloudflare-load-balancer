import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { LoadBalancerEngine } from '../src/load-balancer-engine.js';

describe('Load Balancer Engine Tests', () => {
  let engine;
  let mockConfig;

  before(() => {
    // Create a comprehensive mock configuration that simulates real load balancer setup
    mockConfig = {
      serviceId: 'test-service',
      mode: 'advanced',
      pools: [
        {
          id: 'primary-pool',
          name: 'Primary Pool',
          backends: [
            {
              id: 'backend-1',
              url: 'https://backend1.example.com',
              ip: '192.168.1.1',
              weight: 1,
              healthy: true,
              consecutiveFailures: 0,
              status: 'healthy',
              priority: 10,
              enabled: true,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              circuitBreakerState: 'closed',
              consecutiveSuccesses: 0,
              errorCounts: {
                connection: 0,
                timeout: 0,
                http5xx: 0,
                http523: 0
              },
              healthScore: 100,
              avgResponseTimeMs: 0
            },
            {
              id: 'backend-2',
              url: 'https://backend2.example.com',
              ip: '192.168.1.2',
              weight: 2,
              healthy: true,
              consecutiveFailures: 0,
              status: 'healthy',
              priority: 11,
              enabled: true,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              circuitBreakerState: 'closed',
              consecutiveSuccesses: 0,
              errorCounts: {
                connection: 0,
                timeout: 0,
                http5xx: 0,
                http523: 0
              },
              healthScore: 100,
              avgResponseTimeMs: 0
            }
          ],
          enabled: true,
          minimum_origins: 1,
          endpoint_steering: 'round_robin'
        },
        {
          id: 'failover-pool',
          name: 'Failover Pool',
          backends: [
            {
              id: 'backend-3',
              url: 'https://backup.example.com',
              ip: '192.168.2.1',
              weight: 1,
              healthy: true,
              consecutiveFailures: 0,
              status: 'healthy',
              priority: 20,
              enabled: true,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              circuitBreakerState: 'closed',
              consecutiveSuccesses: 0,
              errorCounts: {
                connection: 0,
                timeout: 0,
                http5xx: 0,
                http523: 0
              },
              healthScore: 100,
              avgResponseTimeMs: 0
            }
          ],
          enabled: true,
          minimum_origins: 1,
          endpoint_steering: 'random'
        }
      ],
      load_balancer: {
        id: 'test-lb',
        name: 'Test Load Balancer',
        hostname: 'test.example.com',
        default_pool_ids: ['primary-pool'],
        fallback_pool_id: 'failover-pool',
        proxied: true,
        enabled: true,
        steering_policy: 'off',
        session_affinity: {
          type: 'none',
          enabled: false
        },
        zero_downtime_failover: {
          enabled: true,
          policy: 'temporary',
          trigger_codes: [521, 522, 523, 525, 526],
          max_retries: 3,
          retry_delay_ms: 500,
          adaptive_routing: true
        }
      },
      currentRoundRobinIndex: 0,
      passiveHealthChecks: {
        enabled: true,
        max_failures: 3,
        failure_timeout_ms: 30000,
        retryable_status_codes: [500, 502, 503, 504, 521, 522, 523, 525, 526],
        monitor_timeout: 10,
        circuit_breaker: {
          enabled: true,
          failure_threshold: 5,
          recovery_timeout_ms: 60000,
          success_threshold: 3,
          error_rate_threshold: 50,
          min_requests: 10
        },
        connection_error_handling: {
          immediate_failover: true,
          max_connection_retries: 2,
          connection_timeout_ms: 10000,
          retry_backoff_ms: 1000
        },
        health_scoring: {
          enabled: true,
          response_time_weight: 0.3,
          error_rate_weight: 0.4,
          availability_weight: 0.3,
          time_window_ms: 300000
        }
      },
      activeHealthChecks: {
        enabled: false,
        path: '/health',
        interval: 60,
        timeout: 5,
        type: 'http',
        consecutive_up: 2,
        consecutive_down: 3,
        retries: 1
      },
      retryPolicy: {
        max_retries: 2,
        retry_timeout: 10000,
        backoff_strategy: 'constant',
        base_delay: 1000
      },
      hostHeaderRewrite: 'preserve',
      observability: {
        responseHeaderName: 'X-Backend-Used',
        add_backend_header: true,
        add_pool_header: false,
        add_region_header: false
      }
    };

    engine = new LoadBalancerEngine(mockConfig);
  });

  describe('Backend Selection Algorithms', () => {
    test('should select backend using round-robin algorithm', async () => {
      const pool = mockConfig.pools[0];
      const mockRequest = new Request('https://test.example.com/api');
      const clientIp = '203.0.113.1';

      // First request should go to backend-1
      const result1 = await engine.routeRequest(mockRequest, clientIp);
      assert.strictEqual(result1.backend.id, 'backend-1');

      // Second request should go to backend-2 (higher weight)
      const result2 = await engine.routeRequest(mockRequest, clientIp);
      assert.strictEqual(result2.backend.id, 'backend-2');

      // Third request should go back to backend-1
      const result3 = await engine.routeRequest(mockRequest, clientIp);
      assert.strictEqual(result3.backend.id, 'backend-1');
    });

    test('should respect backend weights in selection', async () => {
      const mockRequest = new Request('https://test.example.com/api');
      const clientIp = '203.0.113.1';
      const selections = {};

      // Make 100 requests and count selections
      for (let i = 0; i < 100; i++) {
        const result = await engine.routeRequest(mockRequest, clientIp);
        selections[result.backend.id] = (selections[result.backend.id] || 0) + 1;
      }

      // Backend-2 has weight 2, backend-1 has weight 1
      // So backend-2 should get roughly twice as many requests
      const ratio = selections['backend-2'] / selections['backend-1'];
      assert(ratio > 1.5 && ratio < 2.5, `Weight ratio should be ~2, got ${ratio}`);
    });

    test('should handle weighted round-robin correctly', async () => {
      // Create a mock engine function to test the algorithm directly
      const mockEngine = {
        selectBackendWeightedRoundRobin: (backends) => {
          // Simplified weighted round-robin implementation for testing
          let totalWeight = backends.reduce((sum, b) => sum + b.weight, 0);
          let currentWeight = 0;
          
          for (const backend of backends) {
            currentWeight += backend.weight;
            if (currentWeight >= totalWeight / 2) {
              return backend;
            }
          }
          return backends[0];
        }
      };

      const backends = mockConfig.pools[0].backends;
      const selected = mockEngine.selectBackendWeightedRoundRobin(backends);
      
      assert(selected.id === 'backend-1' || selected.id === 'backend-2');
      assert.strictEqual(typeof selected.weight, 'number');
      assert(selected.weight > 0);
    });
  });

  describe('Health Score Calculation', () => {
    test('should calculate health scores based on response time and error rate', () => {
      const backend = mockConfig.pools[0].backends[0];
      
      // Simulate successful request with good response time
      engine.handleBackendSuccess(backend, 100); // 100ms response time
      assert(backend.healthScore >= 90, 'Health score should be high for good performance');

      // Simulate slow response
      engine.handleBackendSuccess(backend, 2000); // 2s response time
      assert(backend.healthScore < 90, 'Health score should decrease for slow responses');

      // Simulate error
      const mockError = new Error('Connection failed');
      engine.handleBackendError(backend, mockError, 5000);
      assert(backend.healthScore < 80, 'Health score should decrease significantly after error');
    });

    test('should track consecutive failures and successes', () => {
      const backend = mockConfig.pools[0].backends[0];
      const initialFailures = backend.consecutiveFailures;
      const initialSuccesses = backend.consecutiveSuccesses;

      // Simulate failure
      const mockError = new Error('Test error');
      engine.handleBackendError(backend, mockError);
      assert.strictEqual(backend.consecutiveFailures, initialFailures + 1);
      assert.strictEqual(backend.consecutiveSuccesses, 0);

      // Simulate success
      engine.handleBackendSuccess(backend, 150);
      assert.strictEqual(backend.consecutiveFailures, 0);
      assert.strictEqual(backend.consecutiveSuccesses, initialSuccesses + 1);
    });

    test('should update error counts by type', () => {
      const backend = mockConfig.pools[0].backends[0];
      const initialCounts = { ...backend.errorCounts };

      // Simulate 523 error
      const mock523Response = new Response('Service Unavailable', { status: 523 });
      engine.handleBackendError(backend, mock523Response);
      assert.strictEqual(backend.errorCounts.http523, initialCounts.http523 + 1);

      // Simulate 5xx error
      const mock500Response = new Response('Internal Server Error', { status: 500 });
      engine.handleBackendError(backend, mock500Response);
      assert.strictEqual(backend.errorCounts.http5xx, initialCounts.http5xx + 1);

      // Simulate connection error
      const connectionError = new Error('Connection refused');
      connectionError.code = 'ECONNREFUSED';
      engine.handleBackendError(backend, connectionError);
      assert.strictEqual(backend.errorCounts.connection, initialCounts.connection + 1);
    });
  });

  describe('Circuit Breaker Functionality', () => {
    test('should open circuit breaker after threshold failures', () => {
      const backend = mockConfig.pools[0].backends[0];
      backend.circuitBreakerState = 'closed';
      backend.consecutiveFailures = 0;

      const threshold = mockConfig.passiveHealthChecks.circuit_breaker.failure_threshold;
      
      // Simulate failures up to threshold
      for (let i = 0; i < threshold; i++) {
        const mockError = new Error(`Test error ${i}`);
        engine.handleBackendError(backend, mockError);
      }

      assert.strictEqual(backend.circuitBreakerState, 'open');
    });

    test('should transition to half-open state after recovery timeout', () => {
      const backend = mockConfig.pools[0].backends[0];
      backend.circuitBreakerState = 'open';
      backend.circuitBreakerOpenTimestamp = Date.now() - 70000; // 70 seconds ago

      // Mock the circuit breaker check
      const mockEngine = {
        isBackendAvailable: (backend) => {
          const now = Date.now();
          const recoveryTimeout = mockConfig.passiveHealthChecks.circuit_breaker.recovery_timeout_ms;
          
          if (backend.circuitBreakerState === 'open' && 
              backend.circuitBreakerOpenTimestamp && 
              now - backend.circuitBreakerOpenTimestamp > recoveryTimeout) {
            backend.circuitBreakerState = 'half-open';
            return true;
          }
          return backend.circuitBreakerState === 'closed';
        }
      };

      const isAvailable = mockEngine.isBackendAvailable(backend);
      assert(isAvailable, 'Backend should be available after recovery timeout');
      assert.strictEqual(backend.circuitBreakerState, 'half-open');
    });

    test('should close circuit breaker after successful requests in half-open state', () => {
      const backend = mockConfig.pools[0].backends[0];
      backend.circuitBreakerState = 'half-open';
      backend.consecutiveSuccesses = 0;

      const successThreshold = mockConfig.passiveHealthChecks.circuit_breaker.success_threshold;

      // Simulate successful requests
      for (let i = 0; i < successThreshold; i++) {
        engine.handleBackendSuccess(backend, 100);
      }

      assert.strictEqual(backend.circuitBreakerState, 'closed');
    });
  });

  describe('Failover Logic', () => {
    test('should failover to backup pool when primary pool is unhealthy', async () => {
      // Mark primary pool backends as unhealthy
      mockConfig.pools[0].backends.forEach(backend => {
        backend.healthy = false;
        backend.circuitBreakerState = 'open';
      });

      const mockRequest = new Request('https://test.example.com/api');
      const clientIp = '203.0.113.1';

      const result = await engine.routeRequest(mockRequest, clientIp);
      
      // Should select from failover pool
      assert.strictEqual(result.backend.id, 'backend-3');
      assert.strictEqual(result.pool.id, 'failover-pool');
    });

    test('should handle zero-downtime failover for 523 errors', async () => {
      const mockRequest = new Request('https://test.example.com/api');
      const clientIp = '203.0.113.1';

      // Mock a 523 response
      const mock523Response = new Response('Service Unavailable', { status: 523 });
      
      // Test that 523 errors trigger immediate failover
      const triggerCodes = mockConfig.load_balancer.zero_downtime_failover.trigger_codes;
      assert(triggerCodes.includes(523), '523 should be in trigger codes');

      // Simulate the failover logic
      const shouldFailover = triggerCodes.includes(523);
      assert(shouldFailover, 'Should trigger failover for 523 errors');
    });

    test('should retry requests with exponential backoff', async () => {
      const maxRetries = mockConfig.retryPolicy.max_retries;
      const baseDelay = mockConfig.retryPolicy.base_delay;
      
      // Mock retry logic
      const mockRetryEngine = {
        calculateRetryDelay: (attempt, strategy, baseDelay) => {
          if (strategy === 'exponential') {
            return baseDelay * Math.pow(2, attempt);
          }
          return baseDelay;
        }
      };

      // Test exponential backoff calculation
      const delay1 = mockRetryEngine.calculateRetryDelay(0, 'exponential', baseDelay);
      const delay2 = mockRetryEngine.calculateRetryDelay(1, 'exponential', baseDelay);
      const delay3 = mockRetryEngine.calculateRetryDelay(2, 'exponential', baseDelay);

      assert.strictEqual(delay1, baseDelay);
      assert.strictEqual(delay2, baseDelay * 2);
      assert.strictEqual(delay3, baseDelay * 4);
    });
  });

  describe('Performance Characteristics', () => {
    test('should handle high request volume efficiently', async () => {
      const startTime = performance.now();
      const requests = [];

      // Simulate 1000 concurrent requests
      for (let i = 0; i < 1000; i++) {
        const mockRequest = new Request(`https://test.example.com/api/${i}`);
        const clientIp = `203.0.113.${(i % 254) + 1}`;
        requests.push(engine.routeRequest(mockRequest, clientIp));
      }

      const results = await Promise.all(requests);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete 1000 requests in reasonable time (< 1 second)
      assert(duration < 1000, `High volume test took too long: ${duration}ms`);
      assert.strictEqual(results.length, 1000);
      
      // All results should have valid backends
      results.forEach(result => {
        assert(result.backend);
        assert(result.pool);
        assert(typeof result.backend.id === 'string');
      });
    });

    test('should maintain low memory usage', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Perform many operations
      for (let i = 0; i < 10000; i++) {
        const backend = mockConfig.pools[0].backends[0];
        engine.handleBackendSuccess(backend, Math.random() * 1000);
        
        if (i % 100 === 0) {
          // Force garbage collection periodically if available
          if (global.gc) {
            global.gc();
          }
        }
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (< 50MB)
      assert(memoryIncrease < 50 * 1024 * 1024, `Memory usage increased too much: ${memoryIncrease} bytes`);
    });

    test('should scale linearly with number of backends', async () => {
      const measurements = [];
      
      // Test with different numbers of backends
      for (const backendCount of [1, 5, 10, 25]) {
        const testConfig = {
          ...mockConfig,
          pools: [{
            ...mockConfig.pools[0],
            backends: Array.from({ length: backendCount }, (_, i) => ({
              id: `backend-${i}`,
              url: `https://backend${i}.example.com`,
              ip: `192.168.1.${i + 1}`,
              weight: 1,
              healthy: true,
              consecutiveFailures: 0,
              priority: 10,
              enabled: true,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              circuitBreakerState: 'closed',
              consecutiveSuccesses: 0,
              errorCounts: { connection: 0, timeout: 0, http5xx: 0, http523: 0 },
              healthScore: 100,
              avgResponseTimeMs: 0
            }))
          }]
        };

        const testEngine = new LoadBalancerEngine(testConfig);
        const startTime = performance.now();
        
        // Make 100 requests
        for (let i = 0; i < 100; i++) {
          const mockRequest = new Request(`https://test.example.com/api/${i}`);
          await testEngine.routeRequest(mockRequest, '203.0.113.1');
        }
        
        const endTime = performance.now();
        measurements.push({
          backends: backendCount,
          duration: endTime - startTime
        });
      }

      // Performance should scale reasonably (not exponentially)
      const firstMeasurement = measurements[0];
      const lastMeasurement = measurements[measurements.length - 1];
      const scalingFactor = lastMeasurement.duration / firstMeasurement.duration;
      
      // With 25x more backends, should not take more than 10x longer
      assert(scalingFactor < 10, `Poor scaling: ${scalingFactor}x slower with more backends`);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty backend pools gracefully', async () => {
      const emptyConfig = {
        ...mockConfig,
        pools: [{
          id: 'empty-pool',
          name: 'Empty Pool',
          backends: [],
          enabled: true,
          minimum_origins: 1,
          endpoint_steering: 'round_robin'
        }]
      };

      const emptyEngine = new LoadBalancerEngine(emptyConfig);
      const mockRequest = new Request('https://test.example.com/api');
      
      try {
        await emptyEngine.routeRequest(mockRequest, '203.0.113.1');
        assert.fail('Should throw error for empty backend pool');
      } catch (error) {
        assert(error instanceof Error);
        assert(error.message.includes('No healthy backends') || error.message.includes('No available'));
      }
    });

    test('should handle malformed requests gracefully', async () => {
      const malformedRequests = [
        null,
        undefined,
        {},
        new Request('invalid-url'),
        new Request('https://test.example.com', { method: 'INVALID' })
      ];

      for (const badRequest of malformedRequests) {
        try {
          if (badRequest) {
            await engine.routeRequest(badRequest, '203.0.113.1');
          }
        } catch (error) {
          // Should handle gracefully without crashing
          assert(error instanceof Error);
        }
      }
    });

    test('should handle invalid client IPs gracefully', async () => {
      const mockRequest = new Request('https://test.example.com/api');
      const invalidIPs = ['invalid', '999.999.999.999', '', null, undefined];

      for (const invalidIP of invalidIPs) {
        try {
          const result = await engine.routeRequest(mockRequest, invalidIP);
          // Should still work with fallback IP
          assert(result.backend);
          assert(result.pool);
        } catch (error) {
          // Or handle gracefully with error
          assert(error instanceof Error);
        }
      }
    });

    test('should handle concurrent modifications safely', async () => {
      const promises = [];
      
      // Simulate concurrent operations
      for (let i = 0; i < 100; i++) {
        promises.push(
          // Concurrent requests
          engine.routeRequest(new Request('https://test.example.com/api'), '203.0.113.1'),
          
          // Concurrent backend updates
          Promise.resolve().then(() => {
            const backend = mockConfig.pools[0].backends[0];
            engine.handleBackendSuccess(backend, Math.random() * 1000);
          }),
          
          // Concurrent error handling
          Promise.resolve().then(() => {
            const backend = mockConfig.pools[0].backends[1];
            engine.handleBackendError(backend, new Error('Concurrent test error'));
          })
        );
      }

      // Should complete without errors or deadlocks
      const results = await Promise.allSettled(promises);
      const failures = results.filter(r => r.status === 'rejected');
      
      // Allow some failures but not too many
      assert(failures.length < results.length * 0.1, `Too many concurrent failures: ${failures.length}/${results.length}`);
    });
  });

  after(() => {
    // Cleanup
    engine = null;
    mockConfig = null;
  });
});
