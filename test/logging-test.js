/**
 * Test ACTUAL TypeScript code from src/logger.ts
 * Run with: npx ts-node test/logging-test.js
 */

require('ts-node/register');

const { Logger } = require('../src/logger.ts');

console.log('🧪 Testing ACTUAL TypeScript Code from src/logger.ts\n');

// Mock environment for testing
const mockEnv = {
	DEBUG: 'true'
};

const mockEnvNoDebug = {
	DEBUG: 'false'
};

// Test function
function testLogging() {
	console.log('=== Testing ACTUAL Logger from src/logger.ts ===\n');

	// Test with DEBUG=true
	console.log('1. Testing with DEBUG=true:');
	const loggerDebug = new Logger(mockEnv, 'test-service');
	
	const mockRequest = new Request('https://example.com/api/test', {
		method: 'GET',
		headers: {
			'user-agent': 'test-agent',
			'x-forwarded-for': '192.168.1.1'
		}
	});

	const mockResponse = new Response('OK', { 
		status: 200, 
		headers: { 'content-type': 'application/json' } 
	});

	const mockBackend = {
		id: 'backend-1',
		url: 'https://backend1.example.com',
		weight: 1,
		healthy: true,
		priority: 10,
		consecutiveFailures: 0,
		consecutiveSuccesses: 5
	};

	loggerDebug.logRequest(mockRequest);
	loggerDebug.logResponse(mockResponse, 150);
	loggerDebug.logBackendSelection(mockBackend, 'round_robin');
	loggerDebug.logHealthCheck(mockBackend, true, 50);
	loggerDebug.logDnsResolution('example.com', true, 25);
	loggerDebug.logFallback('dns', 'load-balancer', 'timeout');

	// Test with DEBUG=false
	console.log('\n2. Testing with DEBUG=false:');
	const loggerNoDebug = new Logger(mockEnvNoDebug, 'test-service');
	
	loggerNoDebug.logRequest(mockRequest);
	loggerNoDebug.logResponse(mockResponse, 150);
	loggerNoDebug.logBackendSelection(mockBackend, 'round_robin');
	loggerNoDebug.logHealthCheck(mockBackend, true, 50);
	loggerNoDebug.logDnsResolution('example.com', true, 25);
	loggerNoDebug.logFallback('dns', 'load-balancer', 'timeout');

	// Test error scenarios
	console.log('\n3. Testing error scenarios:');
	const loggerError = new Logger(mockEnv, 'error-test');
	
	loggerError.error('Backend connection failed', { 
		backendId: 'backend-1', 
		error: 'Connection timeout' 
	});
	loggerError.warn('High latency detected', { 
		backendId: 'backend-2', 
		latency: 2500 
	});
	loggerError.logHealthCheck(mockBackend, false, 5000, { 
		error: 'Health check timeout' 
	});

	console.log('\n=== ACTUAL Logger Test Complete ===');
}

// Run the test
testLogging(); 