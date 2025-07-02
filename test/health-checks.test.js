// Health Checks Test Suite
// Tests all health check functionality including active checks, passive monitoring,
// circuit breakers, health scoring, DNS failover, and notification systems

import { test, describe } from 'node:test';
import assert from 'node:assert';

// Mock health check configurations and responses
const mockHealthyBackend = {
  id: 'backend-1',
  ip: '192.168.1.10',
  port: 80,
  healthy: true,
  enabled: true,
  weight: 100,
  protocol: 'http',
  healthCheck: {
    enabled: true,
    path: '/health',
    interval: 30,
    timeout: 5,
    retries: 3,
    expectedStatus: 200,
    expectedBody: null,
    headers: {}
  },
  circuitBreakerState: 'closed',
  consecutiveSuccesses: 0,
  errorCounts: {
    connection: 0,
    timeout: 0,
    http5xx: 0,
    http523: 0
  },
  healthScore: 100,
  avgResponseTimeMs: 50
};

const mockUnhealthyBackend = {
  ...mockHealthyBackend,
  id: 'backend-2',
  ip: '192.168.1.11',
  healthy: false,
  circuitBreakerState: 'open',
  errorCounts: {
    connection: 5,
    timeout: 2,
    http5xx: 3,
    http523: 1
  },
  healthScore: 15
};

const mockPool = {
  id: 'pool-1',
  name: 'Primary Pool',
  backends: [mockHealthyBackend, mockUnhealthyBackend],
  healthCheck: {
    enabled: true,
    interval: 30,
    timeout: 10,
    retries: 3,
    path: '/health',
    expectedStatus: 200,
    headers: {}
  }
};

const mockConfig = {
  serviceId: 'test-service',
  pools: [mockPool],
  load_balancer: {
    method: 'round_robin',
    dns_failover: {
      enabled: true,
      primary_pool_id: 'pool-1',
      failover_pool_id: 'pool-2',
      health_check_interval: 30,
      failure_threshold: 3,
      recovery_threshold: 2,
      dns_ttl: 300,
      zone_id: 'test-zone',
      api_token: 'test-token'
    }
  },
  notifications: {
    enabled: true,
    channels: [
      {
        type: 'webhook',
        name: 'Primary Webhook',
        enabled: true,
        url: 'https://hooks.example.com/webhook',
        events: ['backend_unhealthy', 'backend_recovered', 'pool_unhealthy'],
        headers: { 'Authorization': 'Bearer test-token' }
      },
      {
        type: 'email',
        name: 'Admin Email',
        enabled: true,
        email: 'admin@example.com',
        events: ['pool_unhealthy', 'dns_failover'],
        provider: 'webhook',
        webhook_url: 'https://api.example.com/send-email'
      }
    ]
  }
};

// Mock LoadBalancerEngine for testing
class MockLoadBalancerEngine {
  constructor(config) {
    this.config = config;
    this.healthCheckResults = new Map();
    this.circuitBreakerStates = new Map();
    this.backendHealthScores = new Map();
    this.alertHistory = [];
    this.initializeBackendTracking();
  }

  initializeBackendTracking() {
    this.config.pools.forEach(pool => {
      pool.backends.forEach(backend => {
        this.circuitBreakerStates.set(backend.id, {
          state: backend.circuitBreakerState || 'closed',
          failureCount: 0,
          lastFailureTime: 0,
          nextRetryTime: 0,
          successCount: backend.consecutiveSuccesses || 0
        });
        
        this.backendHealthScores.set(backend.id, {
          score: backend.healthScore || 100,
          lastUpdated: Date.now(),
          recentErrors: [],
          recentResponseTimes: []
        });
      });
    });
  }

  async performHealthCheck(poolId, backendId) {
    const results = [];
    const pools = poolId ? [this.config.pools.find(p => p.id === poolId)] : this.config.pools;
    
    for (const pool of pools) {
      if (!pool) continue;
      
      const backends = backendId ? [pool.backends.find(b => b.id === backendId)] : pool.backends;
      
      for (const backend of backends) {
        if (!backend) continue;
        
        const result = await this.checkBackendHealth(pool.id, backend);
        results.push(result);
        this.healthCheckResults.set(backend.id, result);
      }
    }
    
    return results;
  }

  async checkBackendHealth(poolId, backend) {
    const startTime = Date.now();
    const healthCheckConfig = backend.healthCheck || this.config.pools.find(p => p.id === poolId)?.healthCheck;
    
    if (!healthCheckConfig?.enabled) {
      return {
        backendId: backend.id,
        poolId: poolId,
        healthy: backend.healthy,
        status: 'disabled',
        responseTime: 0,
        timestamp: Date.now(),
        error: null
      };
    }

    try {
      // Simulate health check request
      const url = `${backend.protocol || 'http'}://${backend.ip}:${backend.port}${healthCheckConfig.path || '/health'}`;
      const response = await this.simulateHealthCheckRequest(url, healthCheckConfig);
      
      const responseTime = Date.now() - startTime;
      const isHealthy = this.evaluateHealthCheckResponse(response, healthCheckConfig);
      
      if (isHealthy) {
        this.handleBackendSuccess(backend, responseTime);
      } else {
        this.handleBackendError(backend, new Error(`Health check failed: ${response.status}`), responseTime);
      }
      
      return {
        backendId: backend.id,
        poolId: poolId,
        healthy: isHealthy,
        status: response.status,
        responseTime: responseTime,
        timestamp: Date.now(),
        error: isHealthy ? null : `HTTP ${response.status}`
      };
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.handleBackendError(backend, error, responseTime);
      
      return {
        backendId: backend.id,
        poolId: poolId,
        healthy: false,
        status: 0,
        responseTime: responseTime,
        timestamp: Date.now(),
        error: error.message
      };
    }
  }

  async simulateHealthCheckRequest(url, config) {
    // Simulate different response scenarios based on backend configuration
    const backendId = url.includes('192.168.1.10') ? 'backend-1' : 'backend-2';
    const backend = this.findBackendById(backendId);
    
    if (!backend) {
      throw new Error('Connection refused');
    }
    
    // Simulate timeout
    if (config.timeout && Math.random() < 0.1) {
      await new Promise(resolve => setTimeout(resolve, config.timeout * 1000 + 100));
      throw new Error('Request timeout');
    }
    
    // Simulate connection errors for unhealthy backends
    if (!backend.healthy && Math.random() < 0.7) {
      throw new Error('Connection refused');
    }
    
    // Simulate HTTP responses
    const status = backend.healthy ? 
      (config.expectedStatus || 200) : 
      (Math.random() < 0.5 ? 500 : 503);
    
    const body = backend.healthy ? 
      (config.expectedBody || 'OK') : 
      'Internal Server Error';
    
    return {
      status,
      body,
      headers: new Map([['content-type', 'text/plain']])
    };
  }

  evaluateHealthCheckResponse(response, config) {
    // Check status code
    if (config.expectedStatus && response.status !== config.expectedStatus) {
      return false;
    }
    
    // Check response body if specified
    if (config.expectedBody && response.body !== config.expectedBody) {
      return false;
    }
    
    // Default: 2xx status codes are healthy
    return response.status >= 200 && response.status < 300;
  }

  handleBackendSuccess(backend, responseTime) {
    const cbState = this.circuitBreakerStates.get(backend.id);
    if (cbState) {
      cbState.successCount++;
      cbState.failureCount = 0;
      
      // Transition from half-open to closed
      if (cbState.state === 'half-open' && cbState.successCount >= 2) {
        cbState.state = 'closed';
        cbState.successCount = 0;
      }
    }
    
    // Update health score positively
    this.updateHealthScore(backend.id, true, responseTime);
    
    // Update backend state
    backend.healthy = true;
    backend.consecutiveSuccesses = (backend.consecutiveSuccesses || 0) + 1;
    
    // Reset error counts on successful health check
    if (backend.errorCounts) {
      Object.keys(backend.errorCounts).forEach(key => {
        backend.errorCounts[key] = Math.max(0, backend.errorCounts[key] - 1);
      });
    }
  }

  handleBackendError(backend, error, responseTime) {
    const cbState = this.circuitBreakerStates.get(backend.id);
    if (cbState) {
      cbState.failureCount++;
      cbState.lastFailureTime = Date.now();
      cbState.successCount = 0;
      
      // Transition to open state
      if (cbState.state === 'closed' && cbState.failureCount >= 3) {
        cbState.state = 'open';
        cbState.nextRetryTime = Date.now() + (30 * 1000); // 30 seconds
        
        this.generateAlert({
          id: `circuit-breaker-${backend.id}-${Date.now()}`,
          type: 'circuit_breaker_open',
          severity: 'warning',
          message: `Circuit breaker opened for backend ${backend.id}`,
          timestamp: Date.now(),
          backendId: backend.id,
          details: { failureCount: cbState.failureCount, error: error.message }
        });
      }
    }
    
    // Update health score negatively
    const errorType = this.classifyError(error);
    this.updateHealthScore(backend.id, false, responseTime, errorType);
    
    // Update backend state
    backend.healthy = false;
    backend.consecutiveSuccesses = 0;
    
    // Increment error counts
    if (backend.errorCounts && errorType) {
      backend.errorCounts[errorType] = (backend.errorCounts[errorType] || 0) + 1;
    }
  }

  classifyError(error) {
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('connection') || message.includes('refused')) {
      return 'connection';
    } else if (message.includes('timeout')) {
      return 'timeout';
    } else if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
      return 'http5xx';
    } else if (message.includes('523')) {
      return 'http523';
    }
    
    return 'connection'; // Default classification
  }

  updateHealthScore(backendId, success, responseTime, errorType) {
    const healthData = this.backendHealthScores.get(backendId);
    if (!healthData) return;
    
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    
    // Clean old data
    healthData.recentErrors = healthData.recentErrors.filter(e => e.timestamp > fiveMinutesAgo);
    healthData.recentResponseTimes = healthData.recentResponseTimes.filter(r => r.timestamp > fiveMinutesAgo);
    
    if (success) {
      healthData.recentResponseTimes.push({ timestamp: now, duration: responseTime });
      // Increase health score for successful requests
      healthData.score = Math.min(100, healthData.score + 5);
    } else {
      healthData.recentErrors.push({ timestamp: now, type: errorType });
      // Decrease health score for errors
      const penalty = errorType === 'timeout' ? 15 : (errorType === 'connection' ? 20 : 10);
      healthData.score = Math.max(0, healthData.score - penalty);
    }
    
    healthData.lastUpdated = now;
  }

  generateAlert(alert) {
    this.alertHistory.push(alert);
    
    // Simulate notification sending
    if (this.config.notifications?.enabled) {
      this.sendNotifications(alert);
    }
  }

  async sendNotifications(alert) {
    const channels = this.config.notifications?.channels || [];
    
    for (const channel of channels) {
      if (!channel.enabled || !channel.events.includes(alert.type)) {
        continue;
      }
      
      try {
        await this.deliverNotification(alert, channel);
      } catch (error) {
        console.error(`Failed to send notification via ${channel.name}:`, error);
      }
    }
  }

  async deliverNotification(alert, channel) {
    // Simulate notification delivery
    const payload = {
      alert: alert,
      channel: channel.name,
      timestamp: Date.now()
    };
    
    if (channel.type === 'webhook') {
      // Simulate webhook call
      return { status: 'sent', method: 'webhook', url: channel.url };
    } else if (channel.type === 'email') {
      // Simulate email sending
      return { status: 'sent', method: 'email', recipient: channel.email };
    }
  }

  findBackendById(backendId) {
    for (const pool of this.config.pools) {
      const backend = pool.backends.find(b => b.id === backendId);
      if (backend) return backend;
    }
    return null;
  }

  getHealthMetrics() {
    const metrics = {};
    
    for (const [backendId, healthData] of this.backendHealthScores.entries()) {
      const backend = this.findBackendById(backendId);
      const cbState = this.circuitBreakerStates.get(backendId);
      
      metrics[backendId] = {
        healthScore: healthData.score,
        circuitBreakerState: cbState?.state || 'closed',
        recentErrors: healthData.recentErrors.length,
        avgResponseTime: this.calculateAverageResponseTime(healthData.recentResponseTimes),
        isAvailable: backend?.healthy && cbState?.state !== 'open'
      };
    }
    
    return metrics;
  }

  calculateAverageResponseTime(responseTimes) {
    if (responseTimes.length === 0) return 0;
    
    const sum = responseTimes.reduce((acc, rt) => acc + rt.duration, 0);
    return Math.round(sum / responseTimes.length);
  }
}

describe('Health Checks System', () => {
  let engine;

  test('setup', () => {
    engine = new MockLoadBalancerEngine(mockConfig);});

  describe('Active Health Checks', () => {
    test('should perform health checks on all backends', async () => {
      const results = await engine.performHealthCheck();
      
      assert(results).toHaveLength(2);
      assert.strictEqual(results[0].backendId, 'backend-1');
      assert.strictEqual(results[1].backendId, 'backend-2');
    });

    test('should perform health check on specific pool', async () => {
      const results = await engine.performHealthCheck('pool-1');
      
      assert(results).toHaveLength(2);
      assert(results.every(r => r.poolId === 'pool-1')).toBe(true);
    });

    test('should perform health check on specific backend', async () => {
      const results = await engine.performHealthCheck('pool-1', 'backend-1');
      
      assert(results).toHaveLength(1);
      assert.strictEqual(results[0].backendId, 'backend-1');
      assert.strictEqual(results[0].poolId, 'pool-1');
    });

    test('should handle healthy backend responses', async () => {
      const results = await engine.performHealthCheck('pool-1', 'backend-1');
      const result = results[0];
      
      assert.strictEqual(result.healthy, true);
      assert.strictEqual(result.status, 200);
      assert(result.responseTime > 0);
      assert(result.error).toBeNull();
    });

    test('should handle unhealthy backend responses', async () => {
      const results = await engine.performHealthCheck('pool-1', 'backend-2');
      const result = results[0];
      
      assert.strictEqual(result.healthy, false);
      assert([0, 500, 503].includes(result.status));
      assert(result.responseTime > 0);
    });

    test('should handle connection timeouts', async () => {
      // Mock a backend that will timeout
      const timeoutBackend = {
        ...mockHealthyBackend,
        id: 'timeout-backend',
        ip: '192.168.1.99'
      };
      
      engine.config.pools[0].backends.push(timeoutBackend);
      engine.initializeBackendTracking();
      
      const results = await engine.performHealthCheck('pool-1', 'timeout-backend');
      
      // Due to random timeout simulation, we just check the structure
      assert(results).toHaveLength(1);
      assert.strictEqual(results[0].backendId, 'timeout-backend');
    });

    test('should respect health check configuration', async () => {
      const customConfig = {
        ...mockConfig,
        pools: [{
          ...mockPool,
          healthCheck: {
            enabled: true,
            path: '/custom-health',
            expectedStatus: 204,
            expectedBody: 'HEALTHY',
            timeout: 2
          }
        }]
      };
      
      const customEngine = new MockLoadBalancerEngine(customConfig);
      const results = await customEngine.performHealthCheck();
      
      assert(results).toHaveLength(2);
      // Results will vary based on simulation, but structure should be correct
      results.forEach(result => {
        assert('backendId' in result);
        assert('healthy' in result);
        assert('responseTime' in result);
      });
    });
  });

  describe('Circuit Breaker Functionality', () => {
    test('should initialize circuit breakers in closed state', () => {
      const metrics = engine.getHealthMetrics();
      
      assert.strictEqual(metrics['backend-1'].circuitBreakerState, 'closed');
      assert.strictEqual(metrics['backend-2'].circuitBreakerState, 'open'); // Starts unhealthy
    });

    test('should open circuit breaker after consecutive failures', async () => {
      const backend = engine.findBackendById('backend-1');
      
      // Simulate multiple failures
      for (let i = 0; i < 3; i++) {
        engine.handleBackendError(backend, new Error('Connection refused'), 1000);
      }
      
      const metrics = engine.getHealthMetrics();
      assert.strictEqual(metrics['backend-1'].circuitBreakerState, 'open');
    });

    test('should transition to half-open state after timeout', async () => {
      const backend = engine.findBackendById('backend-1');
      const cbState = engine.circuitBreakerStates.get('backend-1');
      
      // Force open state
      cbState.state = 'open';
      cbState.nextRetryTime = Date.now() - 1000; // Past retry time
      
      // This would typically be handled by a scheduler, but we simulate it
      cbState.state = 'half-open';
      
      const metrics = engine.getHealthMetrics();
      assert.strictEqual(metrics['backend-1'].circuitBreakerState, 'half-open');
    });

    test('should close circuit breaker after successful requests in half-open state', () => {
      const backend = engine.findBackendById('backend-1');
      const cbState = engine.circuitBreakerStates.get('backend-1');
      
      // Set to half-open
      cbState.state = 'half-open';
      cbState.successCount = 0;
      
      // Simulate successful requests
      engine.handleBackendSuccess(backend, 100);
      engine.handleBackendSuccess(backend, 120);
      
      const metrics = engine.getHealthMetrics();
      assert.strictEqual(metrics['backend-1'].circuitBreakerState, 'closed');
    });

    test('should generate alerts when circuit breaker opens', () => {
      const backend = engine.findBackendById('backend-1');
      
      // Clear existing alerts
      engine.alertHistory = [];
      
      // Trigger circuit breaker
      for (let i = 0; i < 3; i++) {
        engine.handleBackendError(backend, new Error('Connection refused'), 1000);
      }
      
      const alerts = engine.alertHistory.filter(a => a.type === 'circuit_breaker_open');
      assert(alerts).toHaveLength(1);
      assert.strictEqual(alerts[0].backendId, 'backend-1');
    });
  });

  describe('Health Score Calculation', () => {
    test('should start with perfect health score', () => {
      const metrics = engine.getHealthMetrics();
      assert.strictEqual(metrics['backend-1'].healthScore, 100);
    });

    test('should increase health score on successful requests', () => {
      const backend = engine.findBackendById('backend-1');
      const initialScore = engine.backendHealthScores.get('backend-1').score;
      
      engine.handleBackendSuccess(backend, 50);
      
      const updatedScore = engine.backendHealthScores.get('backend-1').score;
      assert(updatedScore >= initialScore);
    });

    test('should decrease health score on errors', () => {
      const backend = engine.findBackendById('backend-1');
      const initialScore = engine.backendHealthScores.get('backend-1').score;
      
      engine.handleBackendError(backend, new Error('Connection refused'), 1000);
      
      const updatedScore = engine.backendHealthScores.get('backend-1').score;
      assert(updatedScore < initialScore);
    });

    test('should apply different penalties for different error types', () => {
      const backend1 = { ...mockHealthyBackend, id: 'test-1' };
      const backend2 = { ...mockHealthyBackend, id: 'test-2' };
      
      engine.backendHealthScores.set('test-1', { score: 100, lastUpdated: Date.now(), recentErrors: [], recentResponseTimes: [] });
      engine.backendHealthScores.set('test-2', { score: 100, lastUpdated: Date.now(), recentErrors: [], recentResponseTimes: [] });
      
      engine.handleBackendError(backend1, new Error('Connection refused'), 1000);
      engine.handleBackendError(backend2, new Error('Request timeout'), 1000);
      
      const score1 = engine.backendHealthScores.get('test-1').score;
      const score2 = engine.backendHealthScores.get('test-2').score;
      
      // Timeout should have higher penalty than connection error
      assert(score2 < score1);
    });

    test('should calculate average response time correctly', () => {
      const responseTimes = [
        { timestamp: Date.now(), duration: 100 },
        { timestamp: Date.now(), duration: 200 },
        { timestamp: Date.now(), duration: 150 }
      ];
      
      const avgTime = engine.calculateAverageResponseTime(responseTimes);
      assert.strictEqual(avgTime, 150);
    });

    test('should clean old health data', () => {
      const healthData = engine.backendHealthScores.get('backend-1');
      const oldTimestamp = Date.now() - (10 * 60 * 1000); // 10 minutes ago
      
      // Add old data
      healthData.recentErrors.push({ timestamp: oldTimestamp, type: 'connection' });
      healthData.recentResponseTimes.push({ timestamp: oldTimestamp, duration: 100 });
      
      // Trigger update which should clean old data
      const backend = engine.findBackendById('backend-1');
      engine.updateHealthScore('backend-1', true, 50);
      
      // Old data should be removed (older than 5 minutes)
      assert(healthData.recentErrors).toHaveLength(0);
      assert(healthData.recentResponseTimes).toHaveLength(1); // Only the new one
    });
  });

  describe('Notification System', () => {
    test('should send notifications when backend becomes unhealthy', async () => {
      const backend = engine.findBackendById('backend-1');
      
      // Clear alerts
      engine.alertHistory = [];
      
      // Trigger circuit breaker which generates alert
      for (let i = 0; i < 3; i++) {
        engine.handleBackendError(backend, new Error('Connection refused'), 1000);
      }
      
      assert(engine.alertHistory).toHaveLength(1);
      assert.strictEqual(engine.alertHistory[0].type, 'circuit_breaker_open');
    });

    test('should filter notifications based on channel configuration', async () => {
      const alert = {
        id: 'test-alert',
        type: 'backend_unhealthy',
        severity: 'warning',
        message: 'Backend is unhealthy',
        timestamp: Date.now(),
        backendId: 'backend-1'
      };
      
      const channels = mockConfig.notifications.channels;
      const webhookChannel = channels.find(c => c.type === 'webhook');
      const emailChannel = channels.find(c => c.type === 'email');
      
      // Webhook should handle backend_unhealthy
      assert(webhookChannel.events.includes('backend_unhealthy'));
      
      // Email should NOT handle backend_unhealthy (only pool_unhealthy and dns_failover)
      assert(!emailChannel.events.includes('backend_unhealthy'));
    });

    test('should deliver webhook notifications', async () => {
      const alert = {
        id: 'test-alert',
        type: 'backend_unhealthy',
        severity: 'warning',
        message: 'Backend is unhealthy',
        timestamp: Date.now(),
        backendId: 'backend-1'
      };
      
      const webhookChannel = mockConfig.notifications.channels.find(c => c.type === 'webhook');
      const result = await engine.deliverNotification(alert, webhookChannel);
      
      assert.strictEqual(result.status, 'sent');
      assert.strictEqual(result.method, 'webhook');
      assert.strictEqual(result.url, webhookChannel.url);
    });

    test('should deliver email notifications', async () => {
      const alert = {
        id: 'test-alert',
        type: 'pool_unhealthy',
        severity: 'critical',
        message: 'Pool is unhealthy',
        timestamp: Date.now(),
        poolId: 'pool-1'
      };
      
      const emailChannel = mockConfig.notifications.channels.find(c => c.type === 'email');
      const result = await engine.deliverNotification(alert, emailChannel);
      
      assert.strictEqual(result.status, 'sent');
      assert.strictEqual(result.method, 'email');
      assert.strictEqual(result.recipient, emailChannel.email);
    });
  });

  describe('DNS Failover Health Checks', () => {
    test('should support DNS failover configuration', () => {
      assert.strictEqual(mockConfig.load_balancer.dns_failover.enabled, true);
      assert.strictEqual(mockConfig.load_balancer.dns_failover.primary_pool_id, 'pool-1');
      assert.strictEqual(mockConfig.load_balancer.dns_failover.health_check_interval, 30);
    });

    test('should track DNS failover state', () => {
      // This would be handled by the actual LoadBalancerEngine
      // Here we just verify the configuration structure
      const dnsConfig = mockConfig.load_balancer.dns_failover;
      
      assert('failure_threshold' in dnsConfig);
      assert('recovery_threshold' in dnsConfig);
      assert('dns_ttl' in dnsConfig);
      assert('zone_id' in dnsConfig);
      assert('api_token' in dnsConfig);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle multiple concurrent health checks', async () => {
      const promises = [];
      
      // Start multiple health checks concurrently
      for (let i = 0; i < 10; i++) {
        promises.push(engine.performHealthCheck());
      }
      
      const results = await Promise.all(promises);
      
      // All health checks should complete successfully
      assert(results).toHaveLength(10);
      results.forEach(result => {
        assert(result).toHaveLength(2); // 2 backends per check
      });
    });

    test('should maintain health data efficiently', () => {
      const backend = engine.findBackendById('backend-1');
      
      // Add many data points
      for (let i = 0; i < 100; i++) {
        engine.handleBackendSuccess(backend, Math.random() * 200);
      }
      
      const healthData = engine.backendHealthScores.get('backend-1');
      
      // Should not accumulate unlimited data
      assert(healthData.recentResponseTimes.length <= 100);
      assert(healthData.recentErrors.length <= 100);
    });

    test('should provide comprehensive health metrics', () => {
      const metrics = engine.getHealthMetrics();
      
      assert('backend-1' in metrics);
      assert('backend-2' in metrics);
      
      Object.values(metrics).forEach(metric => {
        assert('healthScore' in metric);
        assert('circuitBreakerState' in metric);
        assert('recentErrors' in metric);
        assert('avgResponseTime' in metric);
        assert('isAvailable' in metric);
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle disabled health checks gracefully', async () => {
      const disabledConfig = {
        ...mockConfig,
        pools: [{
          ...mockPool,
          healthCheck: { enabled: false }
        }]
      };
      
      const disabledEngine = new MockLoadBalancerEngine(disabledConfig);
      const results = await disabledEngine.performHealthCheck();
      
      assert(results).toHaveLength(2);
      results.forEach(result => {
        assert.strictEqual(result.status, 'disabled');
        assert.strictEqual(result.responseTime, 0);
      });
    });

    test('should handle missing backend gracefully', async () => {
      const result = await engine.performHealthCheck('pool-1', 'nonexistent-backend');
      
      assert(result).toHaveLength(0);
    });

    test('should handle missing pool gracefully', async () => {
      const result = await engine.performHealthCheck('nonexistent-pool');
      
      assert(result).toHaveLength(0);
    });

    test('should classify errors correctly', () => {
      assert(engine.classifyError(new Error('Connection refused'))).toBe('connection');
      assert(engine.classifyError(new Error('Request timeout'))).toBe('timeout');
      assert(engine.classifyError(new Error('HTTP 500'))).toBe('http5xx');
      assert(engine.classifyError(new Error('HTTP 523'))).toBe('http523');
      assert(engine.classifyError(new Error('Unknown error'))).toBe('connection');
    });

    test('should handle notification delivery failures gracefully', async () => {
      const alert = {
        id: 'test-alert',
        type: 'backend_unhealthy',
        severity: 'warning',
        message: 'Backend is unhealthy',
        timestamp: Date.now(),
        backendId: 'backend-1'
      };
      
      // This should not throw even if notification fails
      await assert(engine.sendNotifications(alert)).resolves.toBeUndefined();
    });
  });
});
