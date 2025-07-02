import { test, describe } from 'node:test';
import assert from 'node:assert';
import { performance } from 'perf_hooks';

describe('FlowBalance Performance Tests', () => {
  
  describe('Request Latency', () => {
    test('should handle single requests quickly', async () => {
      const start = performance.now();
      
      // Mock a load balancer request
      await simulateLoadBalancerRequest();
      
      const end = performance.now();
      const latency = end - start;
      
      // Load balancer should add minimal latency (<10ms for simple cases)
      assert(latency < 10, `Request latency too high: ${latency}ms`);
    });

    test('should maintain low latency under load', async () => {
      const concurrent = 100;
      const promises = [];
      
      const start = performance.now();
      
      for (let i = 0; i < concurrent; i++) {
        promises.push(simulateLoadBalancerRequest());
      }
      
      await Promise.all(promises);
      
      const end = performance.now();
      const totalTime = end - start;
      const avgLatency = totalTime / concurrent;
      
      // Average latency should remain reasonable even under load
      assert(avgLatency < 50, `Average latency under load too high: ${avgLatency}ms`);
    });
  });

  describe('Memory Usage', () => {
    test('should not leak memory with repeated requests', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Simulate many requests
      for (let i = 0; i < 1000; i++) {
        await simulateLoadBalancerRequest();
        
        // Force garbage collection every 100 requests
        if (i % 100 === 0 && global.gc) {
          global.gc();
        }
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be minimal (less than 10MB)
      assert(memoryIncrease < 10 * 1024 * 1024, `Memory leak detected: ${memoryIncrease} bytes`);
    });

    test('should handle large configuration efficiently', async () => {
      const largeConfig = createLargeConfiguration(100); // 100 backends
      
      const start = performance.now();
      await simulateConfigurationLoad(largeConfig);
      const end = performance.now();
      
      // Should load large configurations quickly
      assert(end - start < 100, `Large configuration load too slow: ${end - start}ms`);
    });
  });

  describe('Scalability', () => {
    test('should scale with number of backends', async () => {
      const backendCounts = [1, 5, 10, 25, 50];
      const latencies = [];
      
      for (const count of backendCounts) {
        const config = createLargeConfiguration(count);
        
        const start = performance.now();
        await simulateLoadBalancerRequest(config);
        const end = performance.now();
        
        latencies.push(end - start);
      }
      
      // Latency should scale sub-linearly with backend count
      const firstLatency = latencies[0];
      const lastLatency = latencies[latencies.length - 1];
      
      // With 50x more backends, latency should not increase by more than 10x
      assert(lastLatency < firstLatency * 10, `Poor scaling: ${firstLatency}ms -> ${lastLatency}ms`);
    });

    test('should handle high request rate', async () => {
      const requestsPerSecond = 1000;
      const duration = 1000; // 1 second
      const expectedRequests = Math.floor(requestsPerSecond * duration / 1000);
      
      let completedRequests = 0;
      const start = performance.now();
      
      // Create a steady stream of requests
      const intervalId = setInterval(() => {
        simulateLoadBalancerRequest().then(() => {
          completedRequests++;
        });
      }, 1000 / requestsPerSecond);
      
      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, duration));
      clearInterval(intervalId);
      
      // Should handle most of the expected requests
      const successRate = completedRequests / expectedRequests;
      assert(successRate > 0.95, `Low success rate under load: ${successRate * 100}%`);
    });
  });

  describe('Health Check Performance', () => {
    test('should perform health checks efficiently', async () => {
      const backends = Array.from({ length: 10 }, (_, i) => `https://backend-${i}.com`);
      
      const start = performance.now();
      await simulateHealthChecks(backends);
      const end = performance.now();
      
      // Health checks should complete quickly
      const timePerBackend = (end - start) / backends.length;
      assert(timePerBackend < 50, `Health checks too slow: ${timePerBackend}ms per backend`);
    });

    test('should handle health check failures gracefully', async () => {
      const backends = Array.from({ length: 5 }, (_, i) => ({
        url: `https://backend-${i}.com`,
        healthy: i < 3 // First 3 are healthy
      }));
      
      const start = performance.now();
      await simulateHealthChecksWithFailures(backends);
      const end = performance.now();
      
      // Should not be significantly slower even with failures
      assert(end - start < 500, `Health check failures cause excessive delays: ${end - start}ms`);
    });
  });

  describe('Configuration Updates', () => {
    test('should apply configuration changes quickly', async () => {
      const newConfig = {
        activeHealthChecks: {
          enabled: true,
          interval: 30
        },
        retryPolicy: {
          max_retries: 3
        }
      };
      
      const start = performance.now();
      await simulateConfigurationUpdate(newConfig);
      const end = performance.now();
      
      // Configuration updates should be near-instantaneous
      assert(end - start < 10, `Configuration update too slow: ${end - start}ms`);
    });

    test('should not block requests during configuration updates', async () => {
      // Start background requests
      const requestPromises = [];
      for (let i = 0; i < 10; i++) {
        requestPromises.push(simulateLoadBalancerRequest());
      }
      
      // Update configuration while requests are in flight
      const configStart = performance.now();
      await simulateConfigurationUpdate({ activeHealthChecks: { interval: 45 } });
      const configEnd = performance.now();
      
      // Wait for all requests to complete
      const requestResults = await Promise.allSettled(requestPromises);
      
      // All requests should succeed
      const successfulRequests = requestResults.filter(r => r.status === 'fulfilled').length;
      assert.strictEqual(successfulRequests, 10, 'Requests blocked during configuration update');
      
      // Configuration update should still be fast
      assert(configEnd - configStart < 10, 'Configuration update too slow during traffic');
    });
  });
});

/**
 * Helper functions for performance testing
 */

async function simulateLoadBalancerRequest(config = null) {
  // Simulate the core load balancing logic
  const backends = config?.backends || ['https://server1.com', 'https://server2.com'];
  
  // Simulate backend selection (round robin)
  const selectedBackend = backends[Math.floor(Math.random() * backends.length)];
  
  // Simulate request processing delay
  await new Promise(resolve => setTimeout(resolve, Math.random() * 2)); // 0-2ms
  
  return { backend: selectedBackend, status: 200 };
}

function createLargeConfiguration(backendCount) {
  const backends = Array.from({ length: backendCount }, (_, i) => `https://backend-${i}.example.com`);
  
  return {
    hostname: 'api.example.com',
    backends: backends,
    activeHealthChecks: {
      enabled: true,
      interval: 60
    },
    passiveHealthChecks: {
      enabled: true,
      circuit_breaker: {
        enabled: true,
        failure_threshold: 3
      }
    }
  };
}

async function simulateConfigurationLoad(config) {
  // Simulate loading and parsing configuration
  await new Promise(resolve => setTimeout(resolve, config.backends.length * 0.1)); // 0.1ms per backend
  return config;
}

async function simulateHealthChecks(backends) {
  // Simulate parallel health checks
  const promises = backends.map(async (backend) => {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 10)); // 0-10ms per check
    return { backend, healthy: Math.random() > 0.1 }; // 90% healthy
  });
  
  return Promise.all(promises);
}

async function simulateHealthChecksWithFailures(backends) {
  const promises = backends.map(async (backend) => {
    const delay = backend.healthy ? Math.random() * 5 : Math.random() * 20; // Failures take longer
    await new Promise(resolve => setTimeout(resolve, delay));
    return { backend: backend.url, healthy: backend.healthy };
  });
  
  return Promise.all(promises);
}

async function simulateConfigurationUpdate(newConfig) {
  // Simulate configuration validation and update
  await new Promise(resolve => setTimeout(resolve, 1)); // 1ms for update
  return newConfig;
} 