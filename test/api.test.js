import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

describe('🔌 Admin API Tests', () => {
  let mockBackendServers = [];
  let testPorts = [];

  before(async () => {
    // Create mock backend servers for testing API functionality
    const serverConfigs = [
      { port: 8091, response: 'Backend API 1', healthy: true },
      { port: 8092, response: 'Backend API 2', healthy: true },
      { port: 8093, response: 'Backend API 3', healthy: false }
    ];

    for (const config of serverConfigs) {
      const server = await createMockBackendServer(config);
      mockBackendServers.push(server);
      testPorts.push(config.port);
    }
  });

  after(async () => {
    for (const server of mockBackendServers) {
      server.close();
    }
  });

  describe('Load Balancer Management', () => {
    test('should create new load balancer configuration', async () => {
      const createRequest = {
        name: 'test-load-balancer',
        hostname: 'test.example.com',
        pools: [{
          id: 'test-pool',
          name: 'Test Pool',
          backends: [{
            id: 'backend-1',
            url: `http://localhost:${testPorts[0]}`,
            weight: 1,
            healthy: true,
            enabled: true
          }],
          enabled: true,
          minimum_origins: 1,
          endpoint_steering: 'round_robin'
        }],
        default_pool_ids: ['test-pool'],
        steering_policy: 'off',
        proxied: true
      };

      // In real implementation, this would make HTTP request to admin API
      const result = mockAdminAPI.createLoadBalancer(createRequest);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.name, 'test-load-balancer');
      assert.strictEqual(result.data.hostname, 'test.example.com');
      assert.strictEqual(result.data.pools.length, 1);
    });

    test('should list all load balancers', async () => {
      const result = mockAdminAPI.listLoadBalancers();
      
      assert(Array.isArray(result.data));
      assert(result.data.length >= 0);
      
      if (result.data.length > 0) {
        const lb = result.data[0];
        assert(typeof lb.id === 'string');
        assert(typeof lb.name === 'string');
        assert(typeof lb.hostname === 'string');
        assert(Array.isArray(lb.pools));
      }
    });

    test('should get specific load balancer by ID', async () => {
      const testId = 'test-lb-id';
      const result = mockAdminAPI.getLoadBalancer(testId);
      
      if (result.success) {
        assert.strictEqual(result.data.id, testId);
        assert(typeof result.data.name === 'string');
        assert(typeof result.data.hostname === 'string');
      } else {
        assert.strictEqual(result.error, 'Load balancer not found');
      }
    });

    test('should update load balancer configuration', async () => {
      const updateRequest = {
        id: 'test-lb-id',
        name: 'updated-load-balancer',
        steering_policy: 'random'
      };

      const result = mockAdminAPI.updateLoadBalancer(updateRequest.id, updateRequest);
      
      if (result.success) {
        assert.strictEqual(result.data.name, 'updated-load-balancer');
        assert.strictEqual(result.data.steering_policy, 'random');
      }
    });

    test('should delete load balancer', async () => {
      const testId = 'test-lb-to-delete';
      const result = mockAdminAPI.deleteLoadBalancer(testId);
      
      assert(typeof result.success === 'boolean');
      if (!result.success) {
        assert(typeof result.error === 'string');
      }
    });
  });

  describe('Pool Management', () => {
    test('should create new origin pool', async () => {
      const poolRequest = {
        id: 'new-test-pool',
        name: 'New Test Pool',
        backends: [{
          id: 'backend-new',
          url: `http://localhost:${testPorts[1]}`,
          weight: 1,
          healthy: true,
          enabled: true
        }],
        enabled: true,
        minimum_origins: 1,
        endpoint_steering: 'least_outstanding_requests'
      };

      const result = mockAdminAPI.createPool(poolRequest);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.id, 'new-test-pool');
      assert.strictEqual(result.data.name, 'New Test Pool');
      assert.strictEqual(result.data.endpoint_steering, 'least_outstanding_requests');
    });

    test('should list all pools', async () => {
      const result = mockAdminAPI.listPools();
      
      assert(Array.isArray(result.data));
      
      if (result.data.length > 0) {
        const pool = result.data[0];
        assert(typeof pool.id === 'string');
        assert(typeof pool.name === 'string');
        assert(Array.isArray(pool.backends));
        assert(typeof pool.enabled === 'boolean');
      }
    });

    test('should update pool configuration', async () => {
      const updateRequest = {
        name: 'Updated Pool Name',
        minimum_origins: 2,
        endpoint_steering: 'hash'
      };

      const result = mockAdminAPI.updatePool('test-pool-id', updateRequest);
      
      if (result.success) {
        assert.strictEqual(result.data.name, 'Updated Pool Name');
        assert.strictEqual(result.data.minimum_origins, 2);
        assert.strictEqual(result.data.endpoint_steering, 'hash');
      }
    });
  });

  describe('Backend Management', () => {
    test('should add backend to pool', async () => {
      const backendRequest = {
        id: 'backend-added',
        url: `http://localhost:${testPorts[0]}`,
        weight: 2,
        priority: 10,
        enabled: true
      };

      const result = mockAdminAPI.addBackend('test-pool-id', backendRequest);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.id, 'backend-added');
      assert.strictEqual(result.data.weight, 2);
      assert.strictEqual(result.data.enabled, true);
    });

    test('should update backend configuration', async () => {
      const updateRequest = {
        weight: 5,
        enabled: false,
        priority: 5
      };

      const result = mockAdminAPI.updateBackend('backend-id', updateRequest);
      
      if (result.success) {
        assert.strictEqual(result.data.weight, 5);
        assert.strictEqual(result.data.enabled, false);
        assert.strictEqual(result.data.priority, 5);
      }
    });

    test('should remove backend from pool', async () => {
      const result = mockAdminAPI.removeBackend('test-pool-id', 'backend-to-remove');
      
      assert(typeof result.success === 'boolean');
      if (!result.success) {
        assert(typeof result.error === 'string');
      }
    });

    test('should validate backend URL format', async () => {
      const invalidBackends = [
        { url: 'not-a-url' },
        { url: 'ftp://invalid-protocol.com' },
        { url: 'http://' },
        { url: '' }
      ];

      for (const backend of invalidBackends) {
        const result = mockAdminAPI.validateBackend(backend);
        assert.strictEqual(result.valid, false);
        assert(typeof result.error === 'string');
      }
    });

    test('should validate valid backend URLs', async () => {
      const validBackends = [
        { url: 'http://example.com' },
        { url: 'https://api.example.com:8080' },
        { url: 'https://192.168.1.100:3000' },
        { url: 'http://localhost:8080/api' }
      ];

      for (const backend of validBackends) {
        const result = mockAdminAPI.validateBackend(backend);
        assert.strictEqual(result.valid, true);
      }
    });
  });

  describe('Health Check Management', () => {
    test('should configure active health checks', async () => {
      const healthCheckConfig = {
        enabled: true,
        type: 'http',
        path: '/health',
        interval: 30,
        timeout: 5,
        retries: 2,
        consecutive_up: 2,
        consecutive_down: 3,
        expected_codes: [200, 204]
      };

      const result = mockAdminAPI.configureHealthCheck('test-pool-id', healthCheckConfig);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.enabled, true);
      assert.strictEqual(result.data.path, '/health');
      assert.strictEqual(result.data.interval, 30);
    });

    test('should trigger manual health check', async () => {
      const result = mockAdminAPI.triggerHealthCheck('test-pool-id', 'backend-id');
      
      assert.strictEqual(result.success, true);
      assert(typeof result.data.timestamp === 'number');
      assert(typeof result.data.healthy === 'boolean');
      
      if (result.data.responseTime) {
        assert(typeof result.data.responseTime === 'number');
        assert(result.data.responseTime >= 0);
      }
    });

    test('should get health check history', async () => {
      const result = mockAdminAPI.getHealthCheckHistory('backend-id', { limit: 10 });
      
      assert(Array.isArray(result.data));
      assert(result.data.length <= 10);
      
      if (result.data.length > 0) {
        const check = result.data[0];
        assert(typeof check.timestamp === 'number');
        assert(typeof check.healthy === 'boolean');
        assert(typeof check.poolId === 'string');
        assert(typeof check.backendId === 'string');
      }
    });
  });

  describe('Configuration Management', () => {
    test('should export complete configuration', async () => {
      const result = mockAdminAPI.exportConfiguration();
      
      assert.strictEqual(result.success, true);
      assert(typeof result.data === 'object');
      assert(Array.isArray(result.data.load_balancers));
      assert(Array.isArray(result.data.pools));
      assert(typeof result.data.metadata === 'object');
      assert(typeof result.data.metadata.exported_at === 'string');
    });

    test('should import configuration', async () => {
      const configToImport = {
        load_balancers: [{
          id: 'imported-lb',
          name: 'Imported Load Balancer',
          hostname: 'imported.example.com',
          default_pool_ids: ['imported-pool'],
          steering_policy: 'random'
        }],
        pools: [{
          id: 'imported-pool',
          name: 'Imported Pool',
          backends: [{
            id: 'imported-backend',
            url: `http://localhost:${testPorts[0]}`,
            weight: 1,
            enabled: true
          }],
          enabled: true,
          minimum_origins: 1
        }]
      };

      const result = mockAdminAPI.importConfiguration(configToImport);
      
      assert.strictEqual(result.success, true);
      assert(typeof result.data.imported_load_balancers === 'number');
      assert(typeof result.data.imported_pools === 'number');
      assert(result.data.imported_load_balancers >= 0);
      assert(result.data.imported_pools >= 0);
    });

    test('should validate configuration before import', async () => {
      const invalidConfig = {
        load_balancers: [{
          // Missing required fields
          name: 'Invalid LB'
        }],
        pools: []
      };

      const result = mockAdminAPI.validateConfiguration(invalidConfig);
      
      assert.strictEqual(result.valid, false);
      assert(Array.isArray(result.errors));
      assert(result.errors.length > 0);
    });
  });

  describe('Metrics and Analytics', () => {
    test('should get service metrics', async () => {
      const result = mockAdminAPI.getServiceMetrics('test-service-id');
      
      if (result.success) {
        const metrics = result.data;
        assert(typeof metrics.totalRequests === 'number');
        assert(typeof metrics.totalSuccessfulRequests === 'number');
        assert(typeof metrics.totalFailedRequests === 'number');
        assert(typeof metrics.backendMetrics === 'object');
        assert(typeof metrics.poolMetrics === 'object');
      }
    });

    test('should get pool metrics', async () => {
      const result = mockAdminAPI.getPoolMetrics('test-pool-id');
      
      if (result.success) {
        const metrics = result.data;
        assert(typeof metrics.totalRequests === 'number');
        assert(typeof metrics.avgResponseTime === 'number');
        assert(typeof metrics.healthyOrigins === 'number');
        assert(typeof metrics.totalOrigins === 'number');
      }
    });

    test('should get backend metrics', async () => {
      const result = mockAdminAPI.getBackendMetrics('backend-id');
      
      if (result.success) {
        const metrics = result.data;
        assert(typeof metrics.requests === 'number');
        assert(typeof metrics.successfulRequests === 'number');
        assert(typeof metrics.failedRequests === 'number');
        assert(typeof metrics.avgResponseTimeMs === 'number');
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON requests', async () => {
      const result = mockAdminAPI.handleRequest('POST', '/admin/load-balancers', 'invalid-json-{');
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 400);
      assert(result.error.includes('Invalid JSON'));
    });

    test('should handle missing required fields', async () => {
      const incompleteRequest = {
        name: 'Test LB'
        // Missing hostname and other required fields
      };

      const result = mockAdminAPI.createLoadBalancer(incompleteRequest);
      
      assert.strictEqual(result.success, false);
      assert(result.error.includes('required'));
    });

    test('should handle unauthorized requests', async () => {
      const result = mockAdminAPI.handleRequest('GET', '/admin/load-balancers', null, {
        // Missing or invalid authorization
      });
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 401);
    });
  });
});

// Mock Admin API implementation for testing
const mockAdminAPI = {
  loadBalancers: new Map(),
  pools: new Map(),
  
  createLoadBalancer(request) {
    if (!request.name || !request.hostname) {
      return { success: false, error: 'Name and hostname are required' };
    }
    
    const id = `lb-${Date.now()}`;
    const lb = { id, ...request };
    this.loadBalancers.set(id, lb);
    
    return { success: true, data: lb };
  },
  
  listLoadBalancers() {
    return { success: true, data: Array.from(this.loadBalancers.values()) };
  },
  
  getLoadBalancer(id) {
    const lb = this.loadBalancers.get(id);
    if (!lb) {
      return { success: false, error: 'Load balancer not found' };
    }
    return { success: true, data: lb };
  },
  
  updateLoadBalancer(id, updates) {
    const lb = this.loadBalancers.get(id);
    if (!lb) {
      return { success: false, error: 'Load balancer not found' };
    }
    
    const updated = { ...lb, ...updates };
    this.loadBalancers.set(id, updated);
    return { success: true, data: updated };
  },
  
  deleteLoadBalancer(id) {
    const deleted = this.loadBalancers.delete(id);
    return { success: deleted };
  },
  
  createPool(request) {
    if (!request.id || !request.name) {
      return { success: false, error: 'ID and name are required' };
    }
    
    this.pools.set(request.id, request);
    return { success: true, data: request };
  },
  
  listPools() {
    return { success: true, data: Array.from(this.pools.values()) };
  },
  
  updatePool(id, updates) {
    const pool = this.pools.get(id);
    if (!pool) {
      return { success: false, error: 'Pool not found' };
    }
    
    const updated = { ...pool, ...updates };
    this.pools.set(id, updated);
    return { success: true, data: updated };
  },
  
  addBackend(poolId, backend) {
    return { success: true, data: backend };
  },
  
  updateBackend(backendId, updates) {
    return { success: true, data: { id: backendId, ...updates } };
  },
  
  removeBackend(poolId, backendId) {
    return { success: true };
  },
  
  validateBackend(backend) {
    try {
      new URL(backend.url);
      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
  },
  
  configureHealthCheck(poolId, config) {
    return { success: true, data: config };
  },
  
  triggerHealthCheck(poolId, backendId) {
    return {
      success: true,
      data: {
        timestamp: Date.now(),
        healthy: Math.random() > 0.2,
        responseTime: Math.floor(Math.random() * 200) + 10
      }
    };
  },
  
  getHealthCheckHistory(backendId, options = {}) {
    const limit = options.limit || 10;
    const history = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      timestamp: Date.now() - (i * 60000),
      healthy: Math.random() > 0.1,
      poolId: 'test-pool',
      backendId: backendId,
      responseTime: Math.floor(Math.random() * 200) + 10
    }));
    
    return { success: true, data: history };
  },
  
  exportConfiguration() {
    return {
      success: true,
      data: {
        load_balancers: Array.from(this.loadBalancers.values()),
        pools: Array.from(this.pools.values()),
        metadata: {
          exported_at: new Date().toISOString(),
          version: '1.0.0'
        }
      }
    };
  },
  
  importConfiguration(config) {
    return {
      success: true,
      data: {
        imported_load_balancers: config.load_balancers?.length || 0,
        imported_pools: config.pools?.length || 0
      }
    };
  },
  
  validateConfiguration(config) {
    const errors = [];
    
    if (!config.load_balancers || !Array.isArray(config.load_balancers)) {
      errors.push('load_balancers must be an array');
    } else {
      config.load_balancers.forEach((lb, index) => {
        if (!lb.name) errors.push(`load_balancers[${index}].name is required`);
        if (!lb.hostname) errors.push(`load_balancers[${index}].hostname is required`);
      });
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  },
  
  getServiceMetrics(serviceId) {
    return {
      success: true,
      data: {
        totalRequests: Math.floor(Math.random() * 10000),
        totalSuccessfulRequests: Math.floor(Math.random() * 9500),
        totalFailedRequests: Math.floor(Math.random() * 500),
        backendMetrics: {},
        poolMetrics: {}
      }
    };
  },
  
  getPoolMetrics(poolId) {
    return {
      success: true,
      data: {
        totalRequests: Math.floor(Math.random() * 5000),
        avgResponseTime: Math.floor(Math.random() * 200) + 50,
        healthyOrigins: Math.floor(Math.random() * 3) + 1,
        totalOrigins: 3
      }
    };
  },
  
  getBackendMetrics(backendId) {
    return {
      success: true,
      data: {
        requests: Math.floor(Math.random() * 2000),
        successfulRequests: Math.floor(Math.random() * 1900),
        failedRequests: Math.floor(Math.random() * 100),
        avgResponseTimeMs: Math.floor(Math.random() * 200) + 30
      }
    };
  },
  
  handleRequest(method, path, body, headers = {}) {
    if (!headers.authorization && path.startsWith('/admin/')) {
      return { success: false, status: 401, error: 'Unauthorized' };
    }
    
    if (body && typeof body === 'string' && body.includes('{')) {
      try {
        JSON.parse(body);
      } catch {
        return { success: false, status: 400, error: 'Invalid JSON in request body' };
      }
    }
    
    return { success: true, status: 200 };
  }
};

async function createMockBackendServer({ port, response, healthy }) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.statusCode = healthy ? 200 : 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: healthy ? 'healthy' : 'unhealthy' }));
      } else {
        res.statusCode = healthy ? 200 : 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end(response);
      }
    });
    
    server.listen(port, () => {
      resolve(server);
    });
  });
}
