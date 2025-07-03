import { test, describe, before } from 'node:test';
import assert from 'node:assert';

// LoadBalancerEngine class inline
class LoadBalancerEngine {
  constructor(config) {
    this.config = config;
    this.metrics = this.initializeMetrics();
    this.sessionAffinityCache = new Map();
    this.healthCheckResults = new Map();
    this.alertHistory = [];
    this.rttCache = new Map();
    this.circuitBreakerStates = new Map();
    this.backendHealthScores = new Map();
    
    if (this.config.load_balancer?.dns_failover?.enabled) {
      this.dnsState = this.initializeDnsState();
    }
    
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
      poolMetrics,
      dnsFailovers: 0,
      dnsRecoveries: 0,
      steeringDecisions: {},
      sessionAffinityHits: 0,
      sessionAffinityMisses: 0
    };
  }

  initializeDnsState() {
    const primaryPool = this.config.pools.find(p => p.id === this.config.load_balancer.dns_failover?.primary_pool_id);
    const healthyBackends = primaryPool?.backends.filter(b => b.healthy && b.enabled) || [];
    const primaryPoolId = this.config.load_balancer.dns_failover.primary_pool_id;
    
    return {
      current_pool_id: primaryPoolId,
      current_backend_ips: healthyBackends.map(b => b.ip),
      failover_state: 'primary',
      failure_count: 0,
      recovery_count: 0,
      health_check_results: {},
      currentPool: primaryPoolId,
      failoverActive: false
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
        
        this.backendHealthScores.set(backend.id, {
          score: 100,
          lastUpdated: Date.now(),
          recentErrors: [],
          recentResponseTimes: []
        });
        
        if (!backend.circuitBreakerState) {
          backend.circuitBreakerState = 'closed';
          backend.consecutiveSuccesses = 0;
          backend.errorCounts = {
            connection: 0,
            timeout: 0,
            http5xx: 0,
            http523: 0
          };
          backend.healthScore = 100;
          backend.avgResponseTimeMs = 0;
        }
      });
    });
  }

  async selectPool(request, clientIp, geo) {
    const pools = this.config.pools.filter(pool => pool.enabled);
    if (pools.length === 0) return null;

    const steeringPolicy = this.config.load_balancer.steering_policy;
    
    switch (steeringPolicy) {
      case 'off':
        return this.selectPoolFailover(pools);
      case 'random':
        return this.selectPoolRandom(pools);
      case 'round_robin':
        return this.selectPoolRoundRobin(pools);
      default:
        return this.selectPoolFailover(pools);
    }
  }

  selectPoolFailover(pools) {
    // Return first healthy pool
    for (const pool of pools) {
      if (this.isPoolHealthy(pool)) {
        return pool;
      }
    }
    return pools[0] || null; // Fallback to first pool if none healthy
  }

  selectPoolRandom(pools) {
    const healthyPools = pools.filter(pool => this.isPoolHealthy(pool));
    if (healthyPools.length === 0) return pools[0] || null;
    
    return healthyPools[Math.floor(Math.random() * healthyPools.length)];
  }

  selectPoolRoundRobin(pools) {
    if (!this.config.currentRoundRobinIndex) {
      this.config.currentRoundRobinIndex = 0;
    }
    
    const healthyPools = pools.filter(pool => this.isPoolHealthy(pool));
    if (healthyPools.length === 0) return pools[0] || null;
    
    const pool = healthyPools[this.config.currentRoundRobinIndex % healthyPools.length];
    this.config.currentRoundRobinIndex++;
    return pool;
  }

  async selectBackend(pool, request, clientIp) {
    const availableBackends = pool.backends.filter(backend => 
      backend.enabled && backend.healthy && this.isBackendAvailable(backend)
    );
    
    if (availableBackends.length === 0) {
      return null;
    }

    const steeringMethod = pool.endpoint_steering;
    
    switch (steeringMethod) {
      case 'random':
        return this.selectBackendRandom(availableBackends);
      case 'round_robin':
        return this.selectBackendRoundRobin(availableBackends);
      case 'hash':
        return this.selectBackendHash(availableBackends, clientIp);
      case 'least_outstanding_requests':
        return this.selectBackendLeastOutstandingRequests(availableBackends);
      case 'least_connections':
        return this.selectBackendLeastConnections(availableBackends);
      default:
        return this.selectBackendRandom(availableBackends);
    }
  }

  selectBackendRandom(backends) {
    const totalWeight = backends.reduce((sum, backend) => sum + (backend.weight || 1), 0);
    let random = Math.random() * totalWeight;
    
    for (const backend of backends) {
      random -= (backend.weight || 1);
      if (random <= 0) {
        return backend;
      }
    }
    
    return backends[0];
  }

  selectBackendRoundRobin(backends) {
    if (!this.config.currentRoundRobinIndex) {
      this.config.currentRoundRobinIndex = 0;
    }
    
    const backend = backends[this.config.currentRoundRobinIndex % backends.length];
    this.config.currentRoundRobinIndex++;
    return backend;
  }

  selectBackendHash(backends, clientIp) {
    const hash = this.hashString(clientIp);
    const index = Math.abs(hash) % backends.length;
    return backends[index];
  }

  selectBackendLeastOutstandingRequests(backends) {
    return backends.reduce((best, current) => {
      const currentOutstanding = current.outstandingRequests || 0;
      const bestOutstanding = best.outstandingRequests || 0;
      return currentOutstanding < bestOutstanding ? current : best;
    });
  }

  selectBackendLeastConnections(backends) {
    return backends.reduce((best, current) => {
      const currentConnections = this.metrics.backendMetrics[current.id]?.activeConnections || 0;
      const bestConnections = this.metrics.backendMetrics[best.id]?.activeConnections || 0;
      return currentConnections < bestConnections ? current : best;
    });
  }

  isPoolHealthy(pool) {
    const healthyBackends = pool.backends.filter(b => b.healthy && b.enabled);
    return healthyBackends.length >= (pool.minimum_origins || 1);
  }

  isBackendAvailable(backend) {
    const circuitBreakerState = this.circuitBreakerStates.get(backend.id);
    if (!circuitBreakerState) return true;
    
    if (circuitBreakerState.state === 'open') {
      return Date.now() >= circuitBreakerState.nextRetryTime;
    }
    
    return circuitBreakerState.state !== 'open';
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  handleBackendError(backend, error, responseTime) {
    const circuitBreakerState = this.circuitBreakerStates.get(backend.id);
    if (circuitBreakerState) {
      circuitBreakerState.failureCount++;
      circuitBreakerState.lastFailureTime = Date.now();
      
      const threshold = this.config.passiveHealthChecks?.circuit_breaker?.failure_threshold || 5;
      if (circuitBreakerState.failureCount >= threshold) {
        circuitBreakerState.state = 'open';
        const timeout = this.config.passiveHealthChecks?.circuit_breaker?.recovery_timeout_ms || 30000;
        circuitBreakerState.nextRetryTime = Date.now() + timeout;
      }
    }
    
    backend.consecutiveFailures = (backend.consecutiveFailures || 0) + 1;
    backend.lastFailureTimestamp = Date.now();
    
    if (backend.consecutiveFailures >= (this.config.passiveHealthChecks?.max_failures || 3)) {
      backend.healthy = false;
    }
  }

  handleBackendSuccess(backend, responseTime) {
    const circuitBreakerState = this.circuitBreakerStates.get(backend.id);
    if (circuitBreakerState) {
      circuitBreakerState.successCount++;
      
      if (circuitBreakerState.state === 'half-open') {
        const threshold = this.config.passiveHealthChecks?.circuit_breaker?.success_threshold || 3;
        if (circuitBreakerState.successCount >= threshold) {
          circuitBreakerState.state = 'closed';
          circuitBreakerState.failureCount = 0;
          circuitBreakerState.successCount = 0;
        }
      } else if (circuitBreakerState.state === 'open') {
        circuitBreakerState.state = 'half-open';
        circuitBreakerState.successCount = 1;
      }
    }
    
    backend.consecutiveFailures = 0;
    backend.consecutiveSuccesses = (backend.consecutiveSuccesses || 0) + 1;
    backend.lastSuccessTimestamp = Date.now();
    backend.healthy = true;
    
    // Update response time metrics
    if (responseTime) {
      backend.responseTime = responseTime;
      const metrics = this.metrics.backendMetrics[backend.id];
      if (metrics) {
        metrics.totalResponseTimeMs += responseTime;
        metrics.successfulRequests++;
        metrics.avgResponseTimeMs = metrics.totalResponseTimeMs / metrics.successfulRequests;
      }
    }
  }

  async routeRequest(request, clientIp, geo) {
    // Select pool
    const pool = await this.selectPool(request, clientIp, geo);
    if (!pool) {
      throw new Error('No available pools');
    }
    
    // Select backend
    const backend = await this.selectBackend(pool, request, clientIp);
    if (!backend) {
      throw new Error('No available backends in pool');
    }
    
    // Prepare headers
    const headers = this.prepareResponseHeaders(backend, pool);
    
    return { backend, pool, headers };
  }

  prepareResponseHeaders(backend, pool) {
    const headers = {};
    
    if (this.config.observability?.add_backend_header) {
      headers[this.config.observability.responseHeaderName || 'X-Backend-Used'] = backend.id;
    }
    
    if (this.config.observability?.add_pool_header) {
      headers['X-Pool-Used'] = pool.id;
    }
    
    return headers;
  }

  getMetrics() {
    return this.metrics;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.initializeBackendTracking();
  }
}

describe('🔧 Load Balancer Engine Tests', () => {
  let engine;
  let testConfig;

  before(() => {
    // Create test configuration
    testConfig = {
      serviceId: 'test-service',
      currentRoundRobinIndex: 0,
      pools: [
        {
          id: 'pool-1',
          name: 'Primary Pool',
          enabled: true,
          minimum_origins: 1,
          endpoint_steering: 'round_robin',
          backends: [
            {
              id: 'backend-1',
              url: 'https://backend1.example.com',
              ip: '192.168.1.1',
              weight: 1,
              healthy: true,
              enabled: true,
              priority: 1,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              consecutiveFailures: 0
            },
            {
              id: 'backend-2',
              url: 'https://backend2.example.com',
              ip: '192.168.1.2',
              weight: 2,
              healthy: true,
              enabled: true,
              priority: 2,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              consecutiveFailures: 0
            },
            {
              id: 'backend-3',
              url: 'https://backend3.example.com',
              ip: '192.168.1.3',
              weight: 1,
              healthy: false,
              enabled: true,
              priority: 3,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              consecutiveFailures: 3
            }
          ]
        },
        {
          id: 'pool-2',
          name: 'Fallback Pool',
          enabled: true,
          minimum_origins: 1,
          endpoint_steering: 'random',
          backends: [
            {
              id: 'backend-4',
              url: 'https://backend4.example.com',
              ip: '192.168.2.1',
              weight: 1,
              healthy: true,
              enabled: true,
              priority: 1,
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              consecutiveFailures: 0
            }
          ]
        }
      ],
      load_balancer: {
        id: 'lb-1',
        name: 'Test Load Balancer',
        hostname: 'test.example.com',
        default_pool_ids: ['pool-1', 'pool-2'],
        steering_policy: 'off',
        enabled: true,
        proxied: true
      },
      passiveHealthChecks: {
        enabled: true,
        max_failures: 3,
        failure_timeout_ms: 30000,
        retryable_status_codes: [500, 502, 503, 504],
        monitor_timeout: 30,
        circuit_breaker: {
          enabled: true,
          failure_threshold: 5,
          recovery_timeout_ms: 30000,
          success_threshold: 3
        }
      },
      activeHealthChecks: {
        enabled: false,
        type: 'http',
        path: '/health',
        timeout: 10,
        interval: 30,
        retries: 3
      },
      retryPolicy: {
        max_retries: 3,
        retry_timeout: 5000,
        backoff_strategy: 'exponential',
        base_delay: 1000
      },
      observability: {
        responseHeaderName: 'X-Backend-Used',
        add_backend_header: true,
        add_pool_header: true
      }
    };

    engine = new LoadBalancerEngine(testConfig);
  });

  describe('Pool Selection', () => {
    test('should select first healthy pool in failover mode', async () => {
      const request = new Request('https://test.example.com/');
      const clientIp = '1.2.3.4';
      
      const pool = await engine.selectPool(request, clientIp);
      
      assert.strictEqual(pool.id, 'pool-1');
      assert.strictEqual(pool.name, 'Primary Pool');
    });

    test('should select random pool in random mode', async () => {
      engine.config.load_balancer.steering_policy = 'random';
      
      const request = new Request('https://test.example.com/');
      const clientIp = '1.2.3.4';
      
      const pool = await engine.selectPool(request, clientIp);
      
      assert(pool !== null);
      assert(['pool-1', 'pool-2'].includes(pool.id));
    });

    test('should handle round robin pool selection', async () => {
      engine.config.load_balancer.steering_policy = 'round_robin';
      engine.config.currentRoundRobinIndex = 0;
      
      const request = new Request('https://test.example.com/');
      const clientIp = '1.2.3.4';
      
      const pool1 = await engine.selectPool(request, clientIp);
      const pool2 = await engine.selectPool(request, clientIp);
      
      assert.strictEqual(pool1.id, 'pool-1');
      assert.strictEqual(pool2.id, 'pool-2');
    });
  });

  describe('Backend Selection', () => {
    test('should select healthy backend using round robin', async () => {
      const pool = testConfig.pools[0]; // pool-1
      const request = new Request('https://test.example.com/');
      const clientIp = '1.2.3.4';
      
      const backend = await engine.selectBackend(pool, request, clientIp);
      
      assert(backend !== null);
      assert(backend.healthy);
      assert(backend.enabled);
      assert(['backend-1', 'backend-2'].includes(backend.id));
    });

    test('should exclude unhealthy backends', async () => {
      const pool = testConfig.pools[0]; // pool-1
      const request = new Request('https://test.example.com/');
      const clientIp = '1.2.3.4';
      
      // Make multiple selections to ensure backend-3 (unhealthy) is never selected
      const selections = [];
      for (let i = 0; i < 10; i++) {
        const backend = await engine.selectBackend(pool, request, clientIp);
        selections.push(backend.id);
      }
      
      assert(!selections.includes('backend-3'));
      assert(selections.every(id => ['backend-1', 'backend-2'].includes(id)));
    });

    test('should respect backend weights in random selection', async () => {
      const pool = { 
        ...testConfig.pools[0], 
        endpoint_steering: 'random' 
      };
      const request = new Request('https://test.example.com/');
      const clientIp = '1.2.3.4';
      
      // Make multiple selections and check distribution
      const selections = {};
      for (let i = 0; i < 100; i++) {
        const backend = await engine.selectBackend(pool, request, clientIp);
        selections[backend.id] = (selections[backend.id] || 0) + 1;
      }
      
      // backend-2 has weight 2, backend-1 has weight 1
      // So backend-2 should be selected roughly twice as often
      assert(selections['backend-2'] > selections['backend-1']);
    });

    test('should use IP hash for consistent backend selection', async () => {
      const pool = { 
        ...testConfig.pools[0], 
        endpoint_steering: 'hash' 
      };
      const request = new Request('https://test.example.com/');
      const clientIp = '1.2.3.4';
      
      // Same IP should always get same backend
      const backend1 = await engine.selectBackend(pool, request, clientIp);
      const backend2 = await engine.selectBackend(pool, request, clientIp);
      const backend3 = await engine.selectBackend(pool, request, clientIp);
      
      assert.strictEqual(backend1.id, backend2.id);
      assert.strictEqual(backend2.id, backend3.id);
    });
  });

  describe('Health Management', () => {
    test('should mark backend unhealthy after consecutive failures', () => {
      const backend = testConfig.pools[0].backends[0]; // backend-1
      backend.healthy = true;
      backend.consecutiveFailures = 0;
      
      // Simulate failures
      engine.handleBackendError(backend, new Error('Connection failed'));
      assert.strictEqual(backend.consecutiveFailures, 1);
      assert(backend.healthy); // Still healthy after 1 failure
      
      engine.handleBackendError(backend, new Error('Connection failed'));
      engine.handleBackendError(backend, new Error('Connection failed'));
      
      assert.strictEqual(backend.consecutiveFailures, 3);
      assert(!backend.healthy); // Should be unhealthy after 3 failures
    });

    test('should restore backend health after successful request', () => {
      const backend = testConfig.pools[0].backends[2]; // backend-3 (unhealthy)
      backend.healthy = false;
      backend.consecutiveFailures = 3;
      
      engine.handleBackendSuccess(backend, 200);
      
      assert.strictEqual(backend.consecutiveFailures, 0);
      assert(backend.healthy);
      assert(backend.consecutiveSuccesses >= 1);
    });

    test('should implement circuit breaker pattern', () => {
      const backend = testConfig.pools[0].backends[0]; // backend-1
      backend.healthy = true;
      
      // Trigger circuit breaker with multiple failures
      for (let i = 0; i < 5; i++) {
        engine.handleBackendError(backend, new Error('Service unavailable'));
      }
      
      const circuitBreakerState = engine.circuitBreakerStates.get(backend.id);
      assert.strictEqual(circuitBreakerState.state, 'open');
      assert(circuitBreakerState.nextRetryTime > Date.now());
      
      // Backend should not be available while circuit is open
      assert(!engine.isBackendAvailable(backend));
    });
  });

  describe('Request Routing', () => {
    test('should successfully route request to healthy backend', async () => {
      const request = new Request('https://test.example.com/api/data');
      const clientIp = '1.2.3.4';
      
      const result = await engine.routeRequest(request, clientIp);
      
      assert(result.backend !== null);
      assert(result.pool !== null);
      assert(result.headers !== null);
      assert(result.backend.healthy);
      assert(result.backend.enabled);
    });

    test('should include observability headers', async () => {
      const request = new Request('https://test.example.com/api/data');
      const clientIp = '1.2.3.4';
      
      const result = await engine.routeRequest(request, clientIp);
      
      assert(result.headers['X-Backend-Used']);
      assert(result.headers['X-Pool-Used']);
      assert.strictEqual(result.headers['X-Backend-Used'], result.backend.id);
      assert.strictEqual(result.headers['X-Pool-Used'], result.pool.id);
    });
  });

  describe('Metrics', () => {
    test('should initialize metrics correctly', () => {
      const metrics = engine.getMetrics();
      
      assert.strictEqual(metrics.serviceId, 'test-service');
      assert.strictEqual(metrics.totalRequests, 0);
      assert.strictEqual(metrics.totalSuccessfulRequests, 0);
      assert.strictEqual(metrics.totalFailedRequests, 0);
      assert(typeof metrics.backendMetrics === 'object');
      assert(typeof metrics.poolMetrics === 'object');
      
      // Check backend metrics
      assert(metrics.backendMetrics['backend-1']);
      assert(metrics.backendMetrics['backend-2']);
      assert(metrics.backendMetrics['backend-3']);
      assert(metrics.backendMetrics['backend-4']);
      
      // Check pool metrics
      assert(metrics.poolMetrics['pool-1']);
      assert(metrics.poolMetrics['pool-2']);
      assert.strictEqual(metrics.poolMetrics['pool-1'].healthyOrigins, 2); // backend-1 and backend-2
      assert.strictEqual(metrics.poolMetrics['pool-1'].totalOrigins, 3);
      assert.strictEqual(metrics.poolMetrics['pool-2'].healthyOrigins, 1);
      assert.strictEqual(metrics.poolMetrics['pool-2'].totalOrigins, 1);
    });

    test('should update backend metrics on success', () => {
      const backend = testConfig.pools[0].backends[0]; // backend-1
      const responseTime = 150;
      
      engine.handleBackendSuccess(backend, responseTime);
      
      const metrics = engine.getMetrics();
      const backendMetrics = metrics.backendMetrics[backend.id];
      
      assert.strictEqual(backendMetrics.successfulRequests, 1);
      assert.strictEqual(backendMetrics.totalResponseTimeMs, responseTime);
      assert.strictEqual(backendMetrics.avgResponseTimeMs, responseTime);
    });
  });

  describe('Configuration Management', () => {
    test('should update configuration correctly', () => {
      const newConfig = {
        observability: {
          responseHeaderName: 'X-Custom-Backend',
          add_backend_header: false,
          add_pool_header: true
        }
      };
      
      engine.updateConfig(newConfig);
      
      assert.strictEqual(engine.config.observability.responseHeaderName, 'X-Custom-Backend');
      assert.strictEqual(engine.config.observability.add_backend_header, false);
      assert.strictEqual(engine.config.observability.add_pool_header, true);
    });
  });
}); 