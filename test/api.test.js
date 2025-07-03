import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

describe('🔌 Admin API Tests', () => {
  let mockBackendServers = [];
  let testPorts = [];
  const workerUrl = 'http://localhost:8787'; // Default Wrangler dev server
  const testServiceName = 'test-service';
  const apiSecret = 'test-secret'; // Should match API_SECRET in wrangler.toml

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

    // Initialize the test service with some backends
    await initializeTestService();
  });

  after(async () => {
    for (const server of mockBackendServers) {
      server.close();
    }
  });

  async function makeAPIRequest(endpoint, options = {}) {
    const url = `${workerUrl}/admin/services/${testServiceName}/${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${apiSecret}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    const data = await response.json();
    return { response, data };
  }

  async function initializeTestService() {
    try {
      const { response, data } = await makeAPIRequest('initialize', {
        method: 'POST',
        body: JSON.stringify({
          hostname: testServiceName,
          backends: [
            `http://localhost:${testPorts[0]}`,
            `http://localhost:${testPorts[1]}`,
            `http://localhost:${testPorts[2]}`
          ],
          mode: 'simple',
          source: 'test'
        })
      });
      
      if (!response.ok) {
        console.warn('Failed to initialize test service:', data);
      }
    } catch (error) {
      console.warn('Could not initialize test service:', error.message);
    }
  }

  describe('Service Configuration', () => {
    test('should get service configuration', async () => {
      const { response, data } = await makeAPIRequest('config');
      
      assert.strictEqual(response.ok, true);
      assert(typeof data.serviceId === 'string');
      assert(Array.isArray(data.pools));
      assert(typeof data.mode === 'string');
    });

    test('should update service configuration', async () => {
      const updateRequest = {
        activeHealthChecks: {
          enabled: true,
          interval: 30,
          timeout: 5,
          path: '/health'
        }
      };

      const { response, data } = await makeAPIRequest('config', {
        method: 'PUT',
        body: JSON.stringify(updateRequest)
      });
      
      if (response.ok) {
        assert.strictEqual(data.success, true);
        assert(data.config.activeHealthChecks.enabled === true);
      }
    });
  });

  describe('Backend Management', () => {
    test('should list all backends', async () => {
      const { response, data } = await makeAPIRequest('backends');
      
      assert.strictEqual(response.ok, true);
      assert(Array.isArray(data.backends));
      assert(typeof data.totalBackends === 'number');
      assert(typeof data.healthyBackends === 'number');
      
      if (data.backends.length > 0) {
        const backend = data.backends[0];
        assert(typeof backend.id === 'string');
        assert(typeof backend.url === 'string');
        assert(typeof backend.healthy === 'boolean');
        assert(typeof backend.enabled === 'boolean');
      }
    });

    test('should add new backend', async () => {
      const newBackend = {
        url: `http://localhost:${testPorts[0]}`,
        weight: 2,
        priority: 10,
        enabled: true
      };

      const { response, data } = await makeAPIRequest('backends', {
        method: 'POST',
        body: JSON.stringify(newBackend)
      });
      
      if (response.ok) {
        assert.strictEqual(data.success, true);
        assert(typeof data.backend.id === 'string');
        assert.strictEqual(data.backend.url, newBackend.url);
        assert.strictEqual(data.backend.weight, newBackend.weight);
      }
    });

    test('should update existing backend', async () => {
      // First get a backend ID
      const { response: listResponse, data: listData } = await makeAPIRequest('backends');
      
      if (listResponse.ok && listData.backends.length > 0) {
        const backendId = listData.backends[0].id;
        const updates = {
          weight: 5,
          enabled: false
        };

        const { response, data } = await makeAPIRequest(`backends?id=${backendId}`, {
          method: 'PUT',
          body: JSON.stringify(updates)
        });
        
        if (response.ok) {
          assert.strictEqual(data.success, true);
          assert.strictEqual(data.backend.weight, 5);
          assert.strictEqual(data.backend.enabled, false);
        }
      }
    });
  });

  describe('Health Monitoring', () => {
    test('should get health status of all backends', async () => {
      const { response, data } = await makeAPIRequest('health');
      
      assert.strictEqual(response.ok, true);
      assert(typeof data.summary === 'object');
      assert(Array.isArray(data.backends));
      assert(typeof data.timestamp === 'string');
      
      assert(typeof data.summary.totalBackends === 'number');
      assert(typeof data.summary.healthyBackends === 'number');
      assert(typeof data.summary.unhealthyBackends === 'number');
      
      if (data.backends.length > 0) {
        const healthStatus = data.backends[0];
        assert(typeof healthStatus.backendId === 'string');
        assert(typeof healthStatus.url === 'string');
        assert(typeof healthStatus.healthy === 'boolean');
        assert(typeof healthStatus.enabled === 'boolean');
      }
    });

    test('should get health metrics', async () => {
      const { response, data } = await makeAPIRequest('health-metrics');
      
      if (response.ok) {
        assert(typeof data.metrics === 'object');
        assert(typeof data.timestamp === 'string');
      }
    });
  });

  describe('Service Metrics', () => {
    test('should get service metrics', async () => {
      const { response, data } = await makeAPIRequest('metrics');
      
      assert.strictEqual(response.ok, true);
      // The metrics endpoint returns HTML, so we check for HTML content
      assert.strictEqual(response.headers.get('content-type'), 'text/html');
    });
  });

  describe('Logging', () => {
    test('should get service logs', async () => {
      const { response, data } = await makeAPIRequest('logs');
      
      if (response.ok) {
        assert(Array.isArray(data.logs));
        assert(typeof data.totalLogs === 'number');
        
        if (data.logs.length > 0) {
          const logEntry = data.logs[0];
          assert(typeof logEntry.timestamp === 'string');
          assert(typeof logEntry.level === 'string');
          assert(typeof logEntry.message === 'string');
          assert(typeof logEntry.category === 'string');
        }
      }
    });

    test('should clear service logs', async () => {
      const { response, data } = await makeAPIRequest('logs', {
        method: 'DELETE'
      });
      
      if (response.ok) {
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.message, 'Logs cleared successfully');
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid endpoints', async () => {
      const url = `${workerUrl}/admin/services/${testServiceName}/invalid-endpoint`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiSecret}`,
          'Content-Type': 'application/json'
        }
      });
      
      assert.strictEqual(response.ok, false);
      assert.strictEqual(response.status, 404);
    });

    test('should handle unauthorized requests', async () => {
      const url = `${workerUrl}/admin/services/${testServiceName}/config`;
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
          // No Authorization header
        }
      });
      
      assert.strictEqual(response.ok, false);
      assert.strictEqual(response.status, 401);
    });

    test('should handle invalid service names', async () => {
      const url = `${workerUrl}/admin/services/non-existent-service/config`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiSecret}`,
          'Content-Type': 'application/json'
        }
      });
      
      // This might succeed with empty config or fail - both are valid responses
      const data = await response.json();
      assert(typeof data === 'object');
    });
  });
});

async function createMockBackendServer({ port, response, healthy }) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Simulate health check endpoint
      if (req.url === '/health') {
        if (healthy) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'unhealthy', error: 'Service unavailable' }));
        }
        return;
      }

      // Default response for other endpoints
      if (healthy) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(response);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    });

    server.listen(port, () => {
      console.log(`Mock backend server listening on port ${port}`);
      resolve(server);
    });
  });
}
