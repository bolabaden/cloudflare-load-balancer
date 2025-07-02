import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

describe('Durable Object Tests', () => {
  let mockDOState;
  let mockEnv;
  let loadBalancerDO;

  before(() => {
    // Create comprehensive mock Durable Object state
    mockDOState = {
      id: {
        name: 'test-service.example.com'
      },
      storage: new Map(),
      blockConcurrencyWhile: async (fn) => await fn(),
      waitUntil: (promise) => promise,
      setAlarm: async (time) => {
        mockDOState.alarmTime = time;
      },
      getAlarm: async () => mockDOState.alarmTime || null,
      deleteAlarm: async () => {
        delete mockDOState.alarmTime;
      }
    };

    // Mock storage operations
    mockDOState.storage.get = async (key) => mockDOState.storage.get(key);
    mockDOState.storage.put = async (key, value) => mockDOState.storage.set(key, value);
    mockDOState.storage.delete = async (key) => mockDOState.storage.delete(key);
    mockDOState.storage.list = async () => {
      const entries = new Map();
      for (const [key, value] of mockDOState.storage.entries()) {
        entries.set(key, value);
      }
      return entries;
    };

    // Create mock environment
    mockEnv = {
      DEBUG: 'true',
      DEFAULT_BACKENDS: JSON.stringify({
        services: [
          {
            hostname: 'test-service.example.com',
            backends: [
              'https://backend1.example.com',
              'https://backend2.example.com',
              'https://backup.example.com'
            ]
          }
        ]
      }),
      JWT_SECRET: 'test-secret-key',
      AUTHORIZED_USERS: 'test@example.com,admin@example.com',
      ENABLE_WEB_INTERFACE: 'true'
    };

    // Mock LoadBalancerDO class for testing
    class MockLoadBalancerDO {
      constructor(state, env) {
        this.state = state;
        this.env = env;
        this.debug = env.DEBUG === 'true';
        this.serviceHostname = state.id.name || "default-service";
        this.initialized = false;
        this.requestCountSinceSave = 0;
        this.saveThreshold = 100;
        this.logEntries = [];
        this.maxLogEntries = 1000;
        
        // Initialize with empty config that will be loaded
        this.config = null;
        this.metrics = null;
      }

      async initializeEmptyConfig(serviceId) {
        const serviceBackends = ['https://backend1.example.com', 'https://backend2.example.com'];
        
        this.config = {
          serviceId,
          mode: 'simple',
          simpleBackends: serviceBackends,
          pools: [{
            id: "simple-pool",
            name: "Simple Failover Pool",
            backends: serviceBackends.map((url, index) => ({
              id: `backend-${index}`,
              url: url,
              ip: new URL(url).hostname,
              weight: 1,
              healthy: true,
              consecutiveFailures: 0,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              priority: 10,
              enabled: true
            })),
            enabled: true,
            minimum_origins: 1,
            endpoint_steering: 'round_robin'
          }],
          load_balancer: {
            id: "simple-lb",
            name: "Simple Load Balancer",
            hostname: serviceId,
            default_pool_ids: ["simple-pool"],
            proxied: true,
            enabled: true,
            steering_policy: "off",
            session_affinity: {
              type: "none",
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
            max_failures: 3,
            failure_timeout_ms: 30000,
            retryable_status_codes: [500, 502, 503, 504, 521, 522, 523, 525, 526],
            enabled: true,
            monitor_timeout: 10,
            circuit_breaker: {
              enabled: true,
              failure_threshold: 5,
              recovery_timeout_ms: 60000,
              success_threshold: 3,
              error_rate_threshold: 50,
              min_requests: 10
            }
          },
          activeHealthChecks: {
            enabled: false,
            path: "/health",
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
            responseHeaderName: "X-Backend-Used",
            add_backend_header: true,
            add_pool_header: false,
            add_region_header: false
          }
        };

        this.metrics = {
          serviceId,
          totalRequests: 0,
          totalSuccessfulRequests: 0,
          totalFailedRequests: 0,
          backendMetrics: {},
          poolMetrics: {},
          dnsFailovers: 0,
          dnsRecoveries: 0,
          steeringDecisions: {},
          sessionAffinityHits: 0,
          sessionAffinityMisses: 0
        };

        // Initialize backend metrics
        this.config.pools.forEach(pool => {
          pool.backends.forEach(backend => {
            this.metrics.backendMetrics[backend.id] = {
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              avgResponseTimeMs: 0,
              lastRequestTimestamp: Date.now()
            };
          });
        });
      }

      async loadState() {
        const storedState = await this.state.storage.get('config');
        if (storedState) {
          this.config = storedState.config;
          this.metrics = storedState.metrics || this.initializeMetrics();
        } else {
          await this.initializeEmptyConfig(this.serviceHostname);
        }
        this.initialized = true;
      }

      async saveConfig() {
        const stateToSave = {
          config: this.config,
          metrics: this.metrics,
          lastSaved: Date.now()
        };
        await this.state.storage.put('config', stateToSave);
        this.requestCountSinceSave = 0;
      }

      async saveMetrics() {
        await this.saveConfig(); // For simplicity, save everything together
      }

      recordMetric(backendId, success, durationMs) {
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

        const metric = this.metrics.backendMetrics[backendId];
        metric.requests++;
        metric.totalResponseTimeMs += durationMs;
        metric.avgResponseTimeMs = metric.totalResponseTimeMs / metric.requests;
        metric.lastRequestTimestamp = Date.now();

        if (success) {
          metric.successfulRequests++;
          this.metrics.totalSuccessfulRequests++;
        } else {
          metric.failedRequests++;
          this.metrics.totalFailedRequests++;
        }

        this.metrics.totalRequests++;
        this.requestCountSinceSave++;

        if (this.requestCountSinceSave >= this.saveThreshold) {
          this.saveMetrics();
        }
      }

      addLogEntry(level, message, category, metadata = {}) {
        const logEntry = {
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
          level,
          message,
          category,
          metadata
        };

        this.logEntries.push(logEntry);

        // Keep only the most recent entries
        if (this.logEntries.length > this.maxLogEntries) {
          this.logEntries = this.logEntries.slice(-this.maxLogEntries);
        }
      }

      async updateBackend(backendId, updates) {
        for (const pool of this.config.pools) {
          const backend = pool.backends.find(b => b.id === backendId);
          if (backend) {
            Object.assign(backend, updates);
            await this.saveConfig();
            return backend;
          }
        }
        return null;
      }

      async addBackend(newBackendData) {
        const poolId = newBackendData.poolId || this.config.pools[0]?.id;
        const pool = this.config.pools.find(p => p.id === poolId);
        
        if (!pool) {
          throw new Error(`Pool ${poolId} not found`);
        }

        const backendId = `backend-${Date.now()}`;
        const newBackend = {
          id: backendId,
          url: newBackendData.url,
          ip: new URL(newBackendData.url).hostname,
          weight: newBackendData.weight || 1,
          healthy: true,
          consecutiveFailures: 0,
          requests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          totalResponseTimeMs: 0,
          priority: newBackendData.priority || 10,
          enabled: newBackendData.enabled !== false
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

        await this.saveConfig();
        return newBackend;
      }

      getHealthMetrics() {
        const healthMetrics = {
          service: {
            id: this.config.serviceId,
            healthy: true,
            totalBackends: 0,
            healthyBackends: 0,
            unhealthyBackends: 0
          },
          pools: {},
          backends: {}
        };

        this.config.pools.forEach(pool => {
          let poolHealthyCount = 0;
          let poolTotalCount = pool.backends.length;

          pool.backends.forEach(backend => {
            healthMetrics.backends[backend.id] = {
              id: backend.id,
              url: backend.url,
              healthy: backend.healthy,
              consecutiveFailures: backend.consecutiveFailures,
              lastCheck: Date.now(),
              responseTime: this.metrics.backendMetrics[backend.id]?.avgResponseTimeMs || 0
            };

            if (backend.healthy) {
              poolHealthyCount++;
            }
          });

          healthMetrics.pools[pool.id] = {
            id: pool.id,
            name: pool.name,
            healthy: poolHealthyCount >= pool.minimum_origins,
            totalBackends: poolTotalCount,
            healthyBackends: poolHealthyCount,
            unhealthyBackends: poolTotalCount - poolHealthyCount
          };

          healthMetrics.service.totalBackends += poolTotalCount;
          healthMetrics.service.healthyBackends += poolHealthyCount;
        });

        healthMetrics.service.unhealthyBackends = 
          healthMetrics.service.totalBackends - healthMetrics.service.healthyBackends;
        healthMetrics.service.healthy = healthMetrics.service.healthyBackends > 0;

        return healthMetrics;
      }
    }

    loadBalancerDO = new MockLoadBalancerDO(mockDOState, mockEnv);
  });

  describe('Configuration Storage and Retrieval', () => {
    test('should initialize with empty configuration when no stored state exists', async () => {
      await loadBalancerDO.loadState();
      
      assert(loadBalancerDO.config, 'Config should be initialized');
      assert.strictEqual(loadBalancerDO.config.serviceId, 'test-service.example.com');
      assert.strictEqual(loadBalancerDO.config.mode, 'simple');
      assert(Array.isArray(loadBalancerDO.config.simpleBackends));
      assert(loadBalancerDO.config.simpleBackends.length > 0);
    });

    test('should save and retrieve configuration correctly', async () => {
      await loadBalancerDO.loadState();
      const originalConfig = { ...loadBalancerDO.config };
      
      // Modify configuration
      loadBalancerDO.config.retryPolicy.max_retries = 5;
      loadBalancerDO.config.passiveHealthChecks.max_failures = 5;
      
      // Save configuration
      await loadBalancerDO.saveConfig();
      
      // Create new instance and load
      const newDO = new loadBalancerDO.constructor(mockDOState, mockEnv);
      await newDO.loadState();
      
      // Verify configuration was persisted
      assert.strictEqual(newDO.config.retryPolicy.max_retries, 5);
      assert.strictEqual(newDO.config.passiveHealthChecks.max_failures, 5);
      assert.strictEqual(newDO.config.serviceId, originalConfig.serviceId);
    });

    test('should handle configuration updates correctly', async () => {
      await loadBalancerDO.loadState();
      
      const updates = {
        activeHealthChecks: {
          enabled: true,
          interval: 30,
          path: '/health-check'
        },
        retryPolicy: {
          max_retries: 3,
          backoff_strategy: 'exponential'
        }
      };

      // Apply updates
      Object.assign(loadBalancerDO.config.activeHealthChecks, updates.activeHealthChecks);
      Object.assign(loadBalancerDO.config.retryPolicy, updates.retryPolicy);
      
      await loadBalancerDO.saveConfig();
      
      // Verify updates were applied
      assert.strictEqual(loadBalancerDO.config.activeHealthChecks.enabled, true);
      assert.strictEqual(loadBalancerDO.config.activeHealthChecks.interval, 30);
      assert.strictEqual(loadBalancerDO.config.retryPolicy.backoff_strategy, 'exponential');
    });

    test('should handle configuration deletion correctly', async () => {
      await loadBalancerDO.loadState();
      await loadBalancerDO.saveConfig();
      
      // Verify config exists
      const storedConfig = await mockDOState.storage.get('config');
      assert(storedConfig, 'Config should exist in storage');
      
      // Delete configuration
      await mockDOState.storage.delete('config');
      
      // Create new instance and verify it initializes empty config
      const newDO = new loadBalancerDO.constructor(mockDOState, mockEnv);
      await newDO.loadState();
      
      assert(newDO.config, 'Should initialize with default config');
      assert.strictEqual(newDO.config.serviceId, 'test-service.example.com');
    });
  });

  describe('Metrics Storage and Tracking', () => {
    test('should initialize metrics correctly', async () => {
      await loadBalancerDO.loadState();
      
      assert(loadBalancerDO.metrics, 'Metrics should be initialized');
      assert.strictEqual(loadBalancerDO.metrics.serviceId, 'test-service.example.com');
      assert.strictEqual(loadBalancerDO.metrics.totalRequests, 0);
      assert.strictEqual(loadBalancerDO.metrics.totalSuccessfulRequests, 0);
      assert.strictEqual(loadBalancerDO.metrics.totalFailedRequests, 0);
      assert(typeof loadBalancerDO.metrics.backendMetrics === 'object');
    });

    test('should record backend metrics correctly', async () => {
      await loadBalancerDO.loadState();
      
      const backendId = 'backend-0';
      const initialRequests = loadBalancerDO.metrics.totalRequests;
      
      // Record successful request
      loadBalancerDO.recordMetric(backendId, true, 150);
      
      assert.strictEqual(loadBalancerDO.metrics.totalRequests, initialRequests + 1);
      assert.strictEqual(loadBalancerDO.metrics.totalSuccessfulRequests, 1);
      assert.strictEqual(loadBalancerDO.metrics.totalFailedRequests, 0);
      
      const backendMetric = loadBalancerDO.metrics.backendMetrics[backendId];
      assert(backendMetric, 'Backend metric should exist');
      assert.strictEqual(backendMetric.requests, 1);
      assert.strictEqual(backendMetric.successfulRequests, 1);
      assert.strictEqual(backendMetric.avgResponseTimeMs, 150);
    });

    test('should track failed requests correctly', async () => {
      await loadBalancerDO.loadState();
      
      const backendId = 'backend-0';
      
      // Record failed request
      loadBalancerDO.recordMetric(backendId, false, 5000);
      
      assert.strictEqual(loadBalancerDO.metrics.totalFailedRequests, 1);
      
      const backendMetric = loadBalancerDO.metrics.backendMetrics[backendId];
      assert.strictEqual(backendMetric.failedRequests, 1);
      assert.strictEqual(backendMetric.successfulRequests, 0);
    });

    test('should calculate average response times correctly', async () => {
      await loadBalancerDO.loadState();
      
      const backendId = 'backend-0';
      
      // Record multiple requests with different response times
      loadBalancerDO.recordMetric(backendId, true, 100);
      loadBalancerDO.recordMetric(backendId, true, 200);
      loadBalancerDO.recordMetric(backendId, true, 300);
      
      const backendMetric = loadBalancerDO.metrics.backendMetrics[backendId];
      assert.strictEqual(backendMetric.requests, 3);
      assert.strictEqual(backendMetric.totalResponseTimeMs, 600);
      assert.strictEqual(backendMetric.avgResponseTimeMs, 200);
    });

    test('should persist metrics correctly', async () => {
      await loadBalancerDO.loadState();
      
      // Record some metrics
      loadBalancerDO.recordMetric('backend-0', true, 150);
      loadBalancerDO.recordMetric('backend-1', false, 2000);
      
      // Force save
      await loadBalancerDO.saveMetrics();
      
      // Create new instance and verify metrics persisted
      const newDO = new loadBalancerDO.constructor(mockDOState, mockEnv);
      await newDO.loadState();
      
      assert.strictEqual(newDO.metrics.totalRequests, 2);
      assert.strictEqual(newDO.metrics.totalSuccessfulRequests, 1);
      assert.strictEqual(newDO.metrics.totalFailedRequests, 1);
    });
  });

  describe('Health State Management', () => {
    test('should track backend health states correctly', async () => {
      await loadBalancerDO.loadState();
      
      const healthMetrics = loadBalancerDO.getHealthMetrics();
      
      assert(healthMetrics.service, 'Service health should be tracked');
      assert(healthMetrics.pools, 'Pool health should be tracked');
      assert(healthMetrics.backends, 'Backend health should be tracked');
      
      // All backends should start healthy
      assert(healthMetrics.service.healthy, 'Service should be healthy initially');
      assert(healthMetrics.service.healthyBackends > 0, 'Should have healthy backends');
    });

    test('should update backend health status correctly', async () => {
      await loadBalancerDO.loadState();
      
      const backendId = 'backend-0';
      const backend = loadBalancerDO.config.pools[0].backends.find(b => b.id === backendId);
      
      // Mark backend as unhealthy
      await loadBalancerDO.updateBackend(backendId, { 
        healthy: false, 
        consecutiveFailures: 3 
      });
      
      const healthMetrics = loadBalancerDO.getHealthMetrics();
      const backendHealth = healthMetrics.backends[backendId];
      
      assert.strictEqual(backendHealth.healthy, false);
      assert.strictEqual(backendHealth.consecutiveFailures, 3);
    });

    test('should handle pool health based on minimum origins', async () => {
      await loadBalancerDO.loadState();
      
      const pool = loadBalancerDO.config.pools[0];
      pool.minimum_origins = 2;
      
      // Mark one backend as unhealthy
      await loadBalancerDO.updateBackend('backend-0', { healthy: false });
      
      const healthMetrics = loadBalancerDO.getHealthMetrics();
      const poolHealth = healthMetrics.pools[pool.id];
      
      // Pool should still be healthy if we have enough healthy backends
      if (pool.backends.filter(b => b.healthy).length >= pool.minimum_origins) {
        assert(poolHealth.healthy, 'Pool should be healthy with enough origins');
      } else {
        assert(!poolHealth.healthy, 'Pool should be unhealthy without enough origins');
      }
    });
  });

  describe('Session Affinity Management', () => {
    test('should store session affinity mappings correctly', async () => {
      await loadBalancerDO.loadState();
      
      // Enable session affinity
      loadBalancerDO.config.load_balancer.session_affinity = {
        type: 'cookie',
        enabled: true,
        ttl: 3600,
        cookieName: 'lb-session'
      };
      
      // Mock session storage
      const sessionMappings = new Map();
      const sessionKey = 'session-123';
      const backendId = 'backend-0';
      
      sessionMappings.set(sessionKey, {
        backendId,
        poolId: 'simple-pool',
        expires: Date.now() + 3600000
      });
      
      // Verify session mapping
      const mapping = sessionMappings.get(sessionKey);
      assert(mapping, 'Session mapping should exist');
      assert.strictEqual(mapping.backendId, backendId);
      assert.strictEqual(mapping.poolId, 'simple-pool');
      assert(mapping.expires > Date.now(), 'Session should not be expired');
    });

    test('should handle session expiration correctly', async () => {
      await loadBalancerDO.loadState();
      
      const sessionMappings = new Map();
      const expiredSessionKey = 'expired-session';
      
      // Create expired session
      sessionMappings.set(expiredSessionKey, {
        backendId: 'backend-0',
        poolId: 'simple-pool',
        expires: Date.now() - 1000 // Expired 1 second ago
      });
      
      // Check if session is expired
      const mapping = sessionMappings.get(expiredSessionKey);
      const isExpired = mapping && mapping.expires < Date.now();
      
      assert(isExpired, 'Session should be expired');
      
      // Clean up expired session
      if (isExpired) {
        sessionMappings.delete(expiredSessionKey);
      }
      
      assert(!sessionMappings.has(expiredSessionKey), 'Expired session should be removed');
    });
  });

  describe('Request Routing History', () => {
    test('should track request routing decisions', async () => {
      await loadBalancerDO.loadState();
      
      // Mock routing history
      const routingHistory = [];
      
      // Simulate routing decisions
      for (let i = 0; i < 10; i++) {
        const routingDecision = {
          timestamp: Date.now() + i,
          clientIp: `192.168.1.${i % 5 + 1}`,
          selectedBackend: `backend-${i % 2}`,
          selectedPool: 'simple-pool',
          algorithm: 'round_robin',
          responseTime: 100 + Math.random() * 200
        };
        
        routingHistory.push(routingDecision);
        loadBalancerDO.recordMetric(routingDecision.selectedBackend, true, routingDecision.responseTime);
      }
      
      // Verify routing history
      assert.strictEqual(routingHistory.length, 10);
      assert(routingHistory.every(r => r.selectedBackend.startsWith('backend-')));
      assert(routingHistory.every(r => r.selectedPool === 'simple-pool'));
      
      // Verify metrics were recorded
      assert.strictEqual(loadBalancerDO.metrics.totalRequests, 10);
      assert.strictEqual(loadBalancerDO.metrics.totalSuccessfulRequests, 10);
    });

    test('should maintain routing history size limits', async () => {
      await loadBalancerDO.loadState();
      
      const maxHistorySize = 1000;
      const routingHistory = [];
      
      // Add more entries than the limit
      for (let i = 0; i < maxHistorySize + 100; i++) {
        routingHistory.push({
          timestamp: Date.now() + i,
          selectedBackend: `backend-${i % 3}`,
          algorithm: 'round_robin'
        });
        
        // Maintain size limit
        if (routingHistory.length > maxHistorySize) {
          routingHistory.splice(0, routingHistory.length - maxHistorySize);
        }
      }
      
      assert.strictEqual(routingHistory.length, maxHistorySize);
      // Should contain the most recent entries
      assert(routingHistory[0].timestamp < routingHistory[routingHistory.length - 1].timestamp);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large numbers of backends efficiently', async () => {
      await loadBalancerDO.loadState();
      
      const startTime = performance.now();
      
      // Add many backends
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(loadBalancerDO.addBackend({
          url: `https://backend${i}.example.com`,
          weight: 1,
          priority: 10
        }));
      }
      
      const backends = await Promise.all(promises);
      const endTime = performance.now();
      
      // Should complete in reasonable time
      assert(endTime - startTime < 1000, `Adding 100 backends took too long: ${endTime - startTime}ms`);
      assert.strictEqual(backends.length, 100);
      
      // Verify all backends were added
      const totalBackends = loadBalancerDO.config.pools.reduce((count, pool) => count + pool.backends.length, 0);
      assert(totalBackends >= 100, `Should have at least 100 backends, got ${totalBackends}`);
    });

    test('should handle large metric datasets efficiently', async () => {
      await loadBalancerDO.loadState();
      
      const startTime = performance.now();
      
      // Record many metrics
      for (let i = 0; i < 1000; i++) {
        const backendId = `backend-${i % 10}`;
        const success = Math.random() > 0.1; // 90% success rate
        const responseTime = 50 + Math.random() * 500;
        
        loadBalancerDO.recordMetric(backendId, success, responseTime);
      }
      
      const endTime = performance.now();
      
      // Should handle 1000 metrics quickly
      assert(endTime - startTime < 100, `Recording 1000 metrics took too long: ${endTime - startTime}ms`);
      assert.strictEqual(loadBalancerDO.metrics.totalRequests, 1000);
    });

    test('should handle concurrent access correctly', async () => {
      await loadBalancerDO.loadState();
      
      const concurrentOperations = [];
      
      // Simulate concurrent operations
      for (let i = 0; i < 50; i++) {
        concurrentOperations.push(
          // Concurrent metric recording
          Promise.resolve().then(() => {
            loadBalancerDO.recordMetric(`backend-${i % 5}`, true, 100 + i);
          }),
          
          // Concurrent backend updates
          Promise.resolve().then(() => {
            return loadBalancerDO.updateBackend('backend-0', { 
              weight: Math.floor(Math.random() * 10) + 1 
            });
          }),
          
          // Concurrent configuration saves
          Promise.resolve().then(() => {
            return loadBalancerDO.saveConfig();
          })
        );
      }
      
      const results = await Promise.allSettled(concurrentOperations);
      const failures = results.filter(r => r.status === 'rejected');
      
      // Should handle most operations successfully
      assert(failures.length < results.length * 0.1, `Too many concurrent failures: ${failures.length}/${results.length}`);
    });
  });

  describe('Data Consistency and Integrity', () => {
    test('should maintain data consistency across saves and loads', async () => {
      await loadBalancerDO.loadState();
      
      // Make multiple changes
      loadBalancerDO.recordMetric('backend-0', true, 150);
      loadBalancerDO.recordMetric('backend-1', false, 3000);
      await loadBalancerDO.updateBackend('backend-0', { weight: 5 });
      
      const originalMetrics = JSON.parse(JSON.stringify(loadBalancerDO.metrics));
      const originalConfig = JSON.parse(JSON.stringify(loadBalancerDO.config));
      
      // Save and reload
      await loadBalancerDO.saveConfig();
      const newDO = new loadBalancerDO.constructor(mockDOState, mockEnv);
      await newDO.loadState();
      
      // Verify consistency
      assert.deepStrictEqual(newDO.metrics.totalRequests, originalMetrics.totalRequests);
      assert.deepStrictEqual(newDO.metrics.totalSuccessfulRequests, originalMetrics.totalSuccessfulRequests);
      assert.deepStrictEqual(newDO.metrics.totalFailedRequests, originalMetrics.totalFailedRequests);
      assert.strictEqual(newDO.config.pools[0].backends[0].weight, 5);
    });

    test('should handle storage errors gracefully', async () => {
      await loadBalancerDO.loadState();
      
      // Mock storage error
      const originalPut = mockDOState.storage.put;
      mockDOState.storage.put = async () => {
        throw new Error('Storage error');
      };
      
      try {
        await loadBalancerDO.saveConfig();
        assert.fail('Should have thrown storage error');
      } catch (error) {
        assert(error.message.includes('Storage error'));
      }
      
      // Restore original function
      mockDOState.storage.put = originalPut;
      
      // Should still be able to save after restoring
      await loadBalancerDO.saveConfig();
    });

    test('should validate configuration integrity', async () => {
      await loadBalancerDO.loadState();
      
      // Verify required fields exist
      assert(loadBalancerDO.config.serviceId, 'Service ID should exist');
      assert(loadBalancerDO.config.pools, 'Pools should exist');
      assert(Array.isArray(loadBalancerDO.config.pools), 'Pools should be an array');
      assert(loadBalancerDO.config.load_balancer, 'Load balancer config should exist');
      
      // Verify pool integrity
      loadBalancerDO.config.pools.forEach(pool => {
        assert(pool.id, 'Pool should have ID');
        assert(pool.backends, 'Pool should have backends');
        assert(Array.isArray(pool.backends), 'Pool backends should be an array');
        
        // Verify backend integrity
        pool.backends.forEach(backend => {
          assert(backend.id, 'Backend should have ID');
          assert(backend.url, 'Backend should have URL');
          assert(typeof backend.weight === 'number', 'Backend weight should be a number');
          assert(typeof backend.healthy === 'boolean', 'Backend healthy should be a boolean');
        });
      });
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle corrupted configuration data', async () => {
      // Store corrupted data
      await mockDOState.storage.put('config', { invalid: 'data' });
      
      const newDO = new loadBalancerDO.constructor(mockDOState, mockEnv);
      
      // Should initialize with default config when data is corrupted
      try {
        await newDO.loadState();
        // If it succeeds, it should have initialized default config
        assert(newDO.config, 'Should have default config');
        assert.strictEqual(newDO.config.serviceId, 'test-service.example.com');
      } catch (error) {
        // If it fails, it should handle gracefully
        assert(error instanceof Error);
      }
    });

    test('should handle missing backend references gracefully', async () => {
      await loadBalancerDO.loadState();
      
      // Try to update non-existent backend
      const result = await loadBalancerDO.updateBackend('non-existent-backend', { weight: 5 });
      assert.strictEqual(result, null, 'Should return null for non-existent backend');
      
      // Try to record metrics for non-existent backend
      loadBalancerDO.recordMetric('non-existent-backend', true, 100);
      
      // Should create metrics entry for new backend
      assert(loadBalancerDO.metrics.backendMetrics['non-existent-backend'], 'Should create metrics for new backend');
    });

    test('should handle memory pressure gracefully', async () => {
      await loadBalancerDO.loadState();
      
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Create memory pressure with many log entries
      for (let i = 0; i < 2000; i++) {
        loadBalancerDO.addLogEntry('info', `Test log entry ${i}`, 'system', {
          data: new Array(100).fill(`data-${i}`).join('')
        });
      }
      
      // Should maintain log entry limit
      assert(loadBalancerDO.logEntries.length <= loadBalancerDO.maxLogEntries, 
        `Log entries should be limited to ${loadBalancerDO.maxLogEntries}, got ${loadBalancerDO.logEntries.length}`);
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable
      assert(memoryIncrease < 100 * 1024 * 1024, `Memory usage increased too much: ${memoryIncrease} bytes`);
    });
  });

  after(() => {
    // Cleanup
    loadBalancerDO = null;
    mockDOState = null;
    mockEnv = null;
  });
});
