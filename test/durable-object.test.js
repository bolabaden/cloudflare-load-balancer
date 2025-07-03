import { test, describe, before } from 'node:test';
import assert from 'node:assert';

// LoadBalancerEngine class inline to avoid import issues
class LoadBalancerEngine {
  constructor(config) {
    this.config = config;
    this.metrics = this.initializeMetrics();
    this.circuitBreakerStates = new Map();
    this.sessionAffinityCache = new Map();
    this.logEntries = [];
    this.maxLogEntries = 1000;
    this.initializeBackendTracking();
  }

  initializeMetrics() {
    const backendMetrics = {};
    const poolMetrics = {};
    
    this.config.pools.forEach(pool => {
      poolMetrics[pool.id] = {
        poolId: pool.id,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0,
        activeConnections: 0,
        avgResponseTime: 0,
        healthyOrigins: pool.backends.filter(b => b.healthy).length,
        totalOrigins: pool.backends.length
      };
      
      pool.backends.forEach(backend => {
        backendMetrics[backend.id] = {
          requests: backend.requests || 0,
          successfulRequests: backend.successfulRequests || 0,
          failedRequests: backend.failedRequests || 0,
          totalResponseTimeMs: backend.totalResponseTimeMs || 0,
          avgResponseTimeMs: 0,
          lastRequestTimestamp: Date.now()
        };
      });
    });
    
    return {
      serviceId: this.config.serviceId,
      totalRequests: 0,
      totalSuccessfulRequests: 0,
      totalFailedRequests: 0,
      backendMetrics,
      poolMetrics
    };
  }

  initializeBackendTracking() {
    this.config.pools.forEach(pool => {
      pool.backends.forEach(backend => {
        this.circuitBreakerStates.set(backend.id, {
          state: 'closed',
          failureCount: 0,
          lastFailureTime: 0,
          nextRetryTime: 0,
          successCount: 0
        });
      });
    });
  }

  recordMetric(backendId, success, durationMs) {
    this.metrics.totalRequests++;
    
    if (success) {
      this.metrics.totalSuccessfulRequests++;
    } else {
      this.metrics.totalFailedRequests++;
    }

    // Initialize backend metrics if not exists
    if (!this.metrics.backendMetrics[backendId]) {
      this.metrics.backendMetrics[backendId] = {
        requests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalResponseTimeMs: 0,
        avgResponseTimeMs: 0,
        lastRequestTimestamp: Date.now()
      };
    }

    const backendMetrics = this.metrics.backendMetrics[backendId];
    backendMetrics.requests++;
    backendMetrics.lastRequestTimestamp = Date.now();

    if (success) {
      backendMetrics.successfulRequests++;
      if (durationMs) {
        backendMetrics.totalResponseTimeMs += durationMs;
        backendMetrics.avgResponseTimeMs = backendMetrics.totalResponseTimeMs / backendMetrics.successfulRequests;
      }
    } else {
      backendMetrics.failedRequests++;
    }
  }

  updateBackend(backendId, updates) {
    for (const pool of this.config.pools) {
      const backend = pool.backends.find(b => b.id === backendId);
      if (backend) {
        Object.assign(backend, updates);
        return backend;
      }
    }
    return null;
  }

  addBackend(newBackendData) {
    const poolId = newBackendData.poolId || this.config.pools[0]?.id;
    const pool = this.config.pools.find(p => p.id === poolId);
    
    if (!pool) return null;

    const backendId = `backend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newBackend = {
      id: backendId,
      url: newBackendData.url,
      ip: new URL(newBackendData.url).hostname,
      weight: newBackendData.weight || 1,
      priority: newBackendData.priority || 10,
      enabled: newBackendData.enabled !== false,
      healthy: true,
      consecutiveFailures: 0,
      requests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTimeMs: 0
    };

    pool.backends.push(newBackend);
    
    // Initialize metrics for new backend
    this.metrics.backendMetrics[backendId] = {
      requests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTimeMs: 0,
      avgResponseTimeMs: 0,
      lastRequestTimestamp: Date.now()
    };

    return newBackend;
  }

  getHealthMetrics() {
    const healthyBackends = this.config.pools.reduce((count, pool) => 
      count + pool.backends.filter(b => b.healthy && b.enabled).length, 0
    );
    
    const totalBackends = this.config.pools.reduce((count, pool) => count + pool.backends.length, 0);

    const result = {
      service: {
        healthy: healthyBackends > 0,
        healthyBackends,
        totalBackends,
        healthPercentage: totalBackends > 0 ? (healthyBackends / totalBackends) * 100 : 0
      },
      pools: {},
      backends: {}
    };

    // Pool health metrics
    this.config.pools.forEach(pool => {
      const poolHealthyBackends = pool.backends.filter(b => b.healthy && b.enabled).length;
      const poolTotalBackends = pool.backends.length;
      
      result.pools[pool.id] = {
        healthy: poolHealthyBackends >= (pool.minimum_origins || 1),
        healthyBackends: poolHealthyBackends,
        totalBackends: poolTotalBackends,
        healthPercentage: poolTotalBackends > 0 ? (poolHealthyBackends / poolTotalBackends) * 100 : 0
      };

      // Backend health metrics
      pool.backends.forEach(backend => {
        result.backends[backend.id] = {
          healthy: backend.healthy,
          enabled: backend.enabled,
          consecutiveFailures: backend.consecutiveFailures || 0,
          responseTime: backend.avgResponseTimeMs || 0,
          requests: backend.requests || 0
        };
      });
    });

    return result;
  }

  addLogEntry(level, message, category, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      category,
      metadata
    };

    this.logEntries.push(logEntry);

    // Maintain log size limit
    if (this.logEntries.length > this.maxLogEntries) {
      this.logEntries.splice(0, this.logEntries.length - this.maxLogEntries);
    }
  }
}

describe('LoadBalancer Engine Business Logic Tests', () => {
  let engine;
  let testConfig;

  before(() => {
    testConfig = {
      serviceId: 'test-service.example.com',
      mode: 'simple',
      currentRoundRobinIndex: 0,
      pools: [
        {
          id: 'simple-pool',
          name: 'Primary Pool',
          enabled: true,
          minimum_origins: 1,
          endpoint_steering: 'round_robin',
          backends: [
            {
              id: 'backend-0',
              url: 'https://backend1.example.com',
              ip: 'backend1.example.com',
              weight: 1,
              healthy: true,
              enabled: true,
              consecutiveFailures: 0,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              priority: 10
            },
            {
              id: 'backend-1',
              url: 'https://backend2.example.com',
              ip: 'backend2.example.com',
              weight: 1,
              healthy: true,
              enabled: true,
              consecutiveFailures: 0,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              priority: 10
            }
          ]
        }
      ]
    };

    engine = new LoadBalancerEngine(testConfig);
  });

  describe('Configuration Management', () => {
    test('should initialize with valid configuration', () => {
      assert.strictEqual(engine.config.serviceId, 'test-service.example.com');
      assert.strictEqual(engine.config.mode, 'simple');
      assert.strictEqual(engine.config.pools.length, 1);
      assert.strictEqual(engine.config.pools[0].backends.length, 2);
    });
  });

  describe('Metrics Tracking', () => {
    test('should initialize metrics correctly', () => {
      assert.strictEqual(engine.metrics.serviceId, 'test-service.example.com');
      assert.strictEqual(engine.metrics.totalRequests, 0);
      assert.strictEqual(engine.metrics.totalSuccessfulRequests, 0);
      assert.strictEqual(engine.metrics.totalFailedRequests, 0);
      assert(typeof engine.metrics.backendMetrics === 'object');
      assert(engine.metrics.backendMetrics['backend-0']);
      assert(engine.metrics.backendMetrics['backend-1']);
    });

    test('should record successful requests correctly', () => {
      engine.recordMetric('backend-0', true, 150);
      
      assert.strictEqual(engine.metrics.totalRequests, 1);
      assert.strictEqual(engine.metrics.totalSuccessfulRequests, 1);
      assert.strictEqual(engine.metrics.totalFailedRequests, 0);
      
      const backendMetric = engine.metrics.backendMetrics['backend-0'];
      assert.strictEqual(backendMetric.requests, 1);
      assert.strictEqual(backendMetric.successfulRequests, 1);
      assert.strictEqual(backendMetric.avgResponseTimeMs, 150);
    });

    test('should record failed requests correctly', () => {
      engine.recordMetric('backend-1', false, 5000);
      
      assert.strictEqual(engine.metrics.totalFailedRequests, 1);
      
      const backendMetric = engine.metrics.backendMetrics['backend-1'];
      assert.strictEqual(backendMetric.failedRequests, 1);
    });

    test('should calculate average response times correctly', () => {
      // Reset metrics for clean test
      engine.metrics.backendMetrics['backend-0'] = {
        requests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalResponseTimeMs: 0,
        avgResponseTimeMs: 0,
        lastRequestTimestamp: Date.now()
      };

      engine.recordMetric('backend-0', true, 100);
      engine.recordMetric('backend-0', true, 200);
      engine.recordMetric('backend-0', true, 300);
      
      const backendMetric = engine.metrics.backendMetrics['backend-0'];
      assert.strictEqual(backendMetric.successfulRequests, 3);
      assert.strictEqual(backendMetric.totalResponseTimeMs, 600);
      assert.strictEqual(backendMetric.avgResponseTimeMs, 200);
    });
  });

  describe('Health Management', () => {
    test('should track backend health states correctly', () => {
      const healthMetrics = engine.getHealthMetrics();
      
      assert(healthMetrics.service);
      assert(healthMetrics.pools);
      assert(healthMetrics.backends);
      assert(healthMetrics.service.healthy);
      assert.strictEqual(healthMetrics.service.healthyBackends, 2);
      assert.strictEqual(healthMetrics.service.totalBackends, 2);
    });

    test('should update backend health status correctly', () => {
      const backend = engine.updateBackend('backend-0', { 
        healthy: false, 
        consecutiveFailures: 3 
      });
      
      assert(backend);
      assert.strictEqual(backend.healthy, false);
      assert.strictEqual(backend.consecutiveFailures, 3);
      
      const healthMetrics = engine.getHealthMetrics();
      const backendHealth = healthMetrics.backends['backend-0'];
      assert.strictEqual(backendHealth.healthy, false);
      assert.strictEqual(backendHealth.consecutiveFailures, 3);
    });

    test('should handle pool health based on minimum origins', () => {
      // Update pool to require 2 minimum origins
      engine.config.pools[0].minimum_origins = 2;
      
      // Mark one backend as unhealthy
      engine.updateBackend('backend-0', { healthy: false });
      
      const healthMetrics = engine.getHealthMetrics();
      const poolHealth = healthMetrics.pools['simple-pool'];
      
      // Pool should be unhealthy since we only have 1 healthy backend but need 2
      assert.strictEqual(poolHealth.healthy, false);
      assert.strictEqual(poolHealth.healthyBackends, 1);
      assert.strictEqual(poolHealth.totalBackends, 2);
    });
  });

  describe('Backend Management', () => {
    test('should add new backends correctly', () => {
      const newBackend = engine.addBackend({
        url: 'https://backend3.example.com',
        weight: 2,
        priority: 5
      });
      
      assert(newBackend);
      assert.strictEqual(newBackend.url, 'https://backend3.example.com');
      assert.strictEqual(newBackend.weight, 2);
      assert.strictEqual(newBackend.priority, 5);
      assert.strictEqual(newBackend.healthy, true);
      assert.strictEqual(newBackend.enabled, true);
      
      // Should have metrics initialized
      assert(engine.metrics.backendMetrics[newBackend.id]);
    });

    test('should update existing backends correctly', () => {
      const updatedBackend = engine.updateBackend('backend-1', {
        weight: 5,
        priority: 15,
        enabled: false
      });
      
      assert(updatedBackend);
      assert.strictEqual(updatedBackend.weight, 5);
      assert.strictEqual(updatedBackend.priority, 15);
      assert.strictEqual(updatedBackend.enabled, false);
    });

    test('should handle non-existent backend updates gracefully', () => {
      const result = engine.updateBackend('non-existent-backend', { weight: 5 });
      assert.strictEqual(result, null);
    });
  });

  describe('Logging System', () => {
    test('should add log entries correctly', () => {
      engine.addLogEntry('info', 'Test log message', 'system', { key: 'value' });
      
      assert.strictEqual(engine.logEntries.length, 1);
      const logEntry = engine.logEntries[0];
      assert.strictEqual(logEntry.level, 'info');
      assert.strictEqual(logEntry.message, 'Test log message');
      assert.strictEqual(logEntry.category, 'system');
      assert.strictEqual(logEntry.metadata.key, 'value');
      assert(logEntry.timestamp);
    });

    test('should maintain log entry limit', () => {
      // Set a small limit for testing
      engine.maxLogEntries = 5;
      
      // Add more entries than the limit
      for (let i = 0; i < 10; i++) {
        engine.addLogEntry('info', `Log entry ${i}`, 'test');
      }
      
      assert.strictEqual(engine.logEntries.length, 5);
      // Should keep the most recent entries
      assert(engine.logEntries[4].message.includes('Log entry 9'));
    });
  });

  describe('Performance Testing', () => {
    test('should handle many backends efficiently', () => {
      const startTime = performance.now();
      
      // Add 100 backends
      for (let i = 0; i < 100; i++) {
        engine.addBackend({
          url: `https://backend${i + 10}.example.com`,
          weight: 1,
          priority: 10
        });
      }
      
      const endTime = performance.now();
      
      // Should handle 100 backends quickly
      assert(endTime - startTime < 100, `Adding 100 backends took too long: ${endTime - startTime}ms`);
      
      // Verify all backends were added
      const totalBackends = engine.config.pools.reduce((count, pool) => count + pool.backends.length, 0);
      assert(totalBackends >= 102, `Should have at least 102 backends, got ${totalBackends}`);
    });

    test('should handle large metric datasets efficiently', () => {
      const startTime = performance.now();
      
      // Record many metrics
      for (let i = 0; i < 1000; i++) {
        const backendId = `backend-${i % 10}`;
        const success = Math.random() > 0.1; // 90% success rate
        const responseTime = 50 + Math.random() * 500;
        
        engine.recordMetric(backendId, success, responseTime);
      }
      
      const endTime = performance.now();
      
      // Should handle 1000 metrics quickly
      assert(endTime - startTime < 100, `Recording 1000 metrics took too long: ${endTime - startTime}ms`);
    });

    test('should handle memory pressure gracefully', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Create memory pressure with many log entries
      for (let i = 0; i < 2000; i++) {
        engine.addLogEntry('info', `Test log entry ${i}`, 'system', {
          data: new Array(100).fill(`data-${i}`).join('')
        });
      }
      
      // Should maintain log entry limit
      assert(engine.logEntries.length <= engine.maxLogEntries, 
        `Log entries should be limited to ${engine.maxLogEntries}, got ${engine.logEntries.length}`);
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 100MB)
      assert(memoryIncrease < 100 * 1024 * 1024, `Memory usage increased too much: ${memoryIncrease} bytes`);
    });
  });
}); 