#!/usr/bin/env node

/**
 * Test Backend Setup
 * Sets up mock backend servers for health check and integration testing
 */

import { createServer } from 'http';
import { URL } from 'url';

const servers = [];

// Healthy backend server
const healthyServer = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Health check endpoint
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', timestamp: Date.now() }));
    return;
  }
  
  // Default response
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Healthy Backend Server');
});

// Unhealthy backend server
const unhealthyServer = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Health check endpoint returns error
  if (url.pathname === '/health') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'unhealthy', error: 'Service unavailable' }));
    return;
  }
  
  // Default response also fails
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('Internal Server Error');
});

// Slow backend server
const slowServer = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Health check endpoint with delay
  if (url.pathname === '/health') {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'slow', delay: 5000 }));
    }, 5000);
    return;
  }
  
  // Default response with delay
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Slow Backend Server');
  }, 2000);
});

// Intermittent backend server
let intermittentRequestCount = 0;
const intermittentServer = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  intermittentRequestCount++;
  
  // Health check endpoint - fails every other request
  if (url.pathname === '/health') {
    if (intermittentRequestCount % 2 === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', request: intermittentRequestCount }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy', request: intermittentRequestCount }));
    }
    return;
  }
  
  // Default response
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Intermittent Backend Server - Request ${intermittentRequestCount}`);
});

// Start servers
const ports = {
  healthy: 8081,
  unhealthy: 8082,
  slow: 8083,
  intermittent: 8084
};

healthyServer.listen(ports.healthy, () => {
  console.log(`Healthy backend server running on port ${ports.healthy}`);
  servers.push({ name: 'healthy', server: healthyServer, port: ports.healthy });
});

unhealthyServer.listen(ports.unhealthy, () => {
  console.log(`Unhealthy backend server running on port ${ports.unhealthy}`);
  servers.push({ name: 'unhealthy', server: unhealthyServer, port: ports.unhealthy });
});

slowServer.listen(ports.slow, () => {
  console.log(`Slow backend server running on port ${ports.slow}`);
  servers.push({ name: 'slow', server: slowServer, port: ports.slow });
});

intermittentServer.listen(ports.intermittent, () => {
  console.log(`Intermittent backend server running on port ${ports.intermittent}`);
  servers.push({ name: 'intermittent', server: intermittentServer, port: ports.intermittent });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down test backend servers...');
  servers.forEach(({ name, server, port }) => {
    server.close(() => {
      console.log(`${name} server on port ${port} closed`);
    });
  });
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down test backend servers...');
  servers.forEach(({ name, server, port }) => {
    server.close(() => {
      console.log(`${name} server on port ${port} closed`);
    });
  });
  process.exit(0);
});

// Export server configuration for tests
export const testBackends = {
  healthy: `http://localhost:${ports.healthy}`,
  unhealthy: `http://localhost:${ports.unhealthy}`,
  slow: `http://localhost:${ports.slow}`,
  intermittent: `http://localhost:${ports.intermittent}`
};

console.log('Test backend servers started successfully');
console.log('Backend URLs:', testBackends); 