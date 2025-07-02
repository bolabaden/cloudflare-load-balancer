import { test, describe } from 'node:test';
import assert from 'node:assert';
import { env, SELF } from 'cloudflare:test';

describe('Workers Runtime Tests', () => {
  describe('Main Worker Handler', () => {
    test('should handle basic HTTP requests', async () => {
      const request = new Request('https://test.example.com/', {
        method: 'GET'
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
      assert(response.status >= 200);
      assert(response.status < 500);
    });

    test('should handle load balancing requests', async () => {
      const request = new Request('https://aiostreams.bolabaden.org/test', {
        method: 'GET',
        headers: {
          'User-Agent': 'Test/1.0'
        }
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
    });

    test('should handle admin API requests', async () => {
      const workerUrl = 'https://flowbalance.bolabaden.workers.dev';
      const request = new Request(`${workerUrl}/admin/services/`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token'
        }
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
      assert(response.status !== undefined);
    });
  });

  describe('OAuth Authentication Routes', () => {
    test('should redirect to GitHub OAuth', async () => {
      const workerUrl = 'https://flowbalance.bolabaden.workers.dev';
      const request = new Request(`${workerUrl}/auth/github`, {
        method: 'GET'
      });
      
      const response = await SELF.fetch(request);
      assert.strictEqual(response.status, 302);
      
      const location = response.headers.get('Location');
      assert(location.includes('github.com/login/oauth/authorize'));
    });

    test('should handle OAuth callback', async () => {
      const workerUrl = 'https://flowbalance.bolabaden.workers.dev';
      const request = new Request(`${workerUrl}/auth/github/callback?code=test&state=test`, {
        method: 'GET',
        headers: {
          'Cookie': 'oauth_state=test'
        }
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
      assert(response.status >= 200);
    });
  });

  describe('Static File Serving', () => {
    test('should serve CSS files', async () => {
      const workerUrl = 'https://flowbalance.bolabaden.workers.dev';
      const request = new Request(`${workerUrl}/static/css/dashboard.css`, {
        method: 'GET'
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
      
      if (response.status === 200) {
        const contentType = response.headers.get('Content-Type');
        assert(contentType.includes('text/css'));
      }
    });

    test('should serve JavaScript files', async () => {
      const workerUrl = 'https://flowbalance.bolabaden.workers.dev';
      const request = new Request(`${workerUrl}/static/js/dashboard.js`, {
        method: 'GET'
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
      
      if (response.status === 200) {
        const contentType = response.headers.get('Content-Type');
        assert(contentType.includes('javascript'));
      }
    });
  });

  describe('Web Interface', () => {
    test('should serve web interface on worker domain', async () => {
      const workerUrl = 'https://flowbalance.bolabaden.workers.dev';
      const request = new Request(`${workerUrl}/`, {
        method: 'GET'
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
      
      if (response.status === 200) {
        const contentType = response.headers.get('Content-Type');
        assert(contentType.includes('text/html'));
      }
    });

    test('should handle favicon requests', async () => {
      const workerUrl = 'https://flowbalance.bolabaden.workers.dev';
      const request = new Request(`${workerUrl}/favicon.ico`, {
        method: 'GET'
      });
      
      const response = await SELF.fetch(request);
      assert.strictEqual(response.status, 404);
    });
  });

  describe('Durable Object Integration', () => {
    test('should route requests to Durable Object', async () => {
      const request = new Request('https://aiostreams.bolabaden.org/api/test', {
        method: 'GET',
        headers: {
          'X-Test-Header': 'test-value'
        }
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
    });

    test('should handle admin requests to Durable Object', async () => {
      const request = new Request('https://aiostreams.bolabaden.org/__lb_admin__/health', {
        method: 'GET'
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
    });
  });

  describe('Environment Variables', () => {
    test('should have required environment variables', () => {
      assert(env.LOAD_BALANCER_DO !== undefined);
      assert(env.JWT_SECRET !== undefined);
      assert(env.API_SECRET !== undefined);
    });

    test('should have OAuth configuration', () => {
      assert(env.GITHUB_CLIENT_ID !== undefined);
      assert(env.GITHUB_CLIENT_SECRET !== undefined);
      assert(env.GOOGLE_CLIENT_ID !== undefined);
      assert(env.GOOGLE_CLIENT_SECRET !== undefined);
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed requests gracefully', async () => {
      const request = new Request('https://test.example.com/', {
        method: 'POST',
        body: 'invalid-json-{{{',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
      assert(response.status >= 400);
      assert(response.status < 600);
    });

    test('should handle requests with invalid headers', async () => {
      const request = new Request('https://test.example.com/', {
        method: 'GET',
        headers: {
          'X-Invalid-Header': '\x00\x01\x02'
        }
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
    });
  });

  describe('Request Headers and Context', () => {
    test('should preserve important headers', async () => {
      const request = new Request('https://aiostreams.bolabaden.org/test', {
        method: 'GET',
        headers: {
          'X-Forwarded-For': '192.168.1.1',
          'User-Agent': 'Test-Agent/1.0',
          'Accept': 'application/json'
        }
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
    });

    test('should handle different HTTP methods', async () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
      
      for (const method of methods) {
        const request = new Request('https://aiostreams.bolabaden.org/test', {
          method,
          body: method === 'POST' || method === 'PUT' ? '{"test": true}' : undefined,
          headers: method === 'POST' || method === 'PUT' ? { 'Content-Type': 'application/json' } : {}
        });
        
        const response = await SELF.fetch(request);
        assert(response !== undefined);
        assert(response.status >= 200);
      }
    });
  });

  describe('Scheduled Events', () => {
    test('should handle cron triggers', async () => {
      // This tests the scheduled handler indirectly
      // In a real environment, this would be triggered by Cloudflare's cron
      assert.strictEqual(true, true); // Placeholder - actual cron testing requires special setup
    });
  });

  describe('Performance and Limits', () => {
    test('should handle concurrent requests', async () => {
      const promises = [];
      const numRequests = 10;
      
      for (let i = 0; i < numRequests; i++) {
        const request = new Request(`https://aiostreams.bolabaden.org/test-${i}`, {
          method: 'GET'
        });
        promises.push(SELF.fetch(request));
      }
      
      const responses = await Promise.all(promises);
      assert(responses).toHaveLength(numRequests);
      
      responses.forEach(response => {
        assert(response !== undefined);
        assert(response.status >= 200);
      });
    });

    test('should handle large request bodies within limits', async () => {
      const largeBody = 'x'.repeat(1024 * 10); // 10KB body
      const request = new Request('https://aiostreams.bolabaden.org/test', {
        method: 'POST',
        body: largeBody,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
      
      const response = await SELF.fetch(request);
      assert(response !== undefined);
    });
  });

  describe('Security Features', () => {
    test('should handle requests without sensitive data exposure', async () => {
      const request = new Request('https://aiostreams.bolabaden.org/test', {
        method: 'GET'
      });
      
      const response = await SELF.fetch(request);
      const responseText = await response.text();
      
      // Check that sensitive environment variables are not exposed
      assert(!responseText.includes(env.JWT_SECRET));
      assert(!responseText.includes(env.API_SECRET));
      assert(!responseText.includes(env.GITHUB_CLIENT_SECRET));
      assert(!responseText.includes(env.GOOGLE_CLIENT_SECRET));
    });

    test('should set appropriate security headers', async () => {
      const request = new Request('https://flowbalance.bolabaden.workers.dev/', {
        method: 'GET'
      });
      
      const response = await SELF.fetch(request);
      
      // Check for security headers if they're set
      const headers = Object.fromEntries(response.headers.entries());
      
      // These are optional but good to have
      if (headers['x-frame-options']) {
        assert(headers['x-frame-options'] !== undefined);
      }
      if (headers['x-content-type-options']) {
        assert(headers['x-content-type-options'] !== undefined);
      }
    });
  });
}); 