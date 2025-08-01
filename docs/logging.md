# Comprehensive Logging System

This document describes the comprehensive logging system implemented in the Cloudflare Load Balancer Worker, which provides two distinct verbosity levels based on the `DEBUG` environment variable.

## Overview

The logging system provides structured, contextual logging with two verbosity levels:

- **Production Mode** (`DEBUG=false`): Minimal, essential logs for monitoring and alerting
- **Debug Mode** (`DEBUG=true`): Comprehensive, detailed logs for troubleshooting and development

## Configuration

The logging system is controlled by the `DEBUG` environment variable in `wrangler.jsonc`:

```json
"vars": {
  "DEBUG": "true",  // Set to "false" for production
  // ... other variables
}
```

## Logger Class

The `Logger` class is the core component of the logging system, located in `src/logger.ts`.

### Constructor

```typescript
const logger = new Logger(env: Env, serviceId: string = 'global')
```

- `env`: Environment object containing the `DEBUG` variable
- `serviceId`: Identifier for the service/component (e.g., 'main-worker', 'durable-object')

### Log Levels

1. **Debug** (`logger.debug()`): Only shown when `DEBUG=true`
2. **Info** (`logger.info()`): Always shown
3. **Warning** (`logger.warn()`): Always shown
4. **Error** (`logger.error()`): Always shown

## Specialized Logging Methods

### Request/Response Logging

```typescript
// Log incoming request details
logger.logRequest(request: Request, context?: LogContext)

// Log outgoing response details
logger.logResponse(response: Response, duration: number, context?: LogContext)
```

**Production Mode Output:**
```
[INFO] [main-worker] Request: GET /api/users { clientIp: '192.168.1.1', hostname: 'example.com' }
[INFO] [main-worker] Response: 200 OK (150ms) { statusCode: 200, duration: 150 }
```

**Debug Mode Output:**
```
[DEBUG] [main-worker] Request received {
  url: 'https://example.com/api/users',
  method: 'GET',
  clientIp: '192.168.1.1',
  userAgent: 'Mozilla/5.0...',
  hostname: 'example.com',
  pathname: '/api/users',
  query: '',
  headers: { 'user-agent': '...', 'accept': 'application/json' }
}
[DEBUG] [main-worker] Response sent {
  statusCode: 200,
  statusText: 'OK',
  duration: 150,
  headers: { 'content-type': 'application/json' }
}
```

### Backend Selection Logging

```typescript
logger.logBackendSelection(backend: Backend, algorithm: string, context?: LogContext)
```

**Production Mode Output:**
```
[INFO] [load-balancer] Backend selected: backend-1 (round_robin) { backendId: 'backend-1', algorithm: 'round_robin' }
```

**Debug Mode Output:**
```
[DEBUG] [load-balancer] Backend selected {
  backendId: 'backend-1',
  backendUrl: 'https://backend1.example.com',
  algorithm: 'round_robin',
  backendWeight: 1,
  backendHealthy: true,
  backendPriority: 10
}
```

### Health Check Logging

```typescript
logger.logHealthCheck(backend: Backend, healthy: boolean, duration: number, context?: LogContext)
```

**Production Mode Output:**
```
[INFO] [health-check] Health check: backend-1 healthy (50ms) { backendId: 'backend-1', healthy: true, duration: 50 }
[INFO] [health-check] Health check: backend-2 unhealthy (5000ms) { backendId: 'backend-2', healthy: false, duration: 5000 }
```

**Debug Mode Output:**
```
[DEBUG] [health-check] Health check passed {
  backendId: 'backend-1',
  backendUrl: 'https://backend1.example.com',
  healthy: true,
  duration: 50,
  previousHealth: true,
  consecutiveFailures: 0,
  consecutiveSuccesses: 5,
  statusCode: 200,
  isStatusValid: true,
  isBodyValid: true
}
```

### DNS Resolution Logging

```typescript
logger.logDnsResolution(hostname: string, success: boolean, duration?: number, error?: string, context?: LogContext)
```

**Production Mode Output:**
```
[INFO] [dns] DNS: example.com resolved (25ms) { hostname: 'example.com', success: true, duration: 25 }
[INFO] [dns] DNS: failing.example.com failed (10000ms) { hostname: 'failing.example.com', success: false, duration: 10000 }
```

**Debug Mode Output:**
```
[DEBUG] [dns] DNS resolution succeeded {
  hostname: 'example.com',
  success: true,
  duration: 25,
  error: undefined
}
[DEBUG] [dns] DNS resolution failed {
  hostname: 'failing.example.com',
  success: false,
  duration: 10000,
  error: 'timeout'
}
```

### Fallback Logging

```typescript
logger.logFallback(from: string, to: string, reason: string, context?: LogContext)
```

**Production Mode Output:**
```
[WARN] [fallback] Fallback: dns → load-balancer { from: 'dns', to: 'load-balancer', reason: 'timeout' }
```

**Debug Mode Output:**
```
[DEBUG] [fallback] Fallback: dns → load-balancer (timeout) {
  from: 'dns',
  to: 'load-balancer',
  reason: 'timeout',
  timestamp: 1754014019477
}
```

### Circuit Breaker Logging

```typescript
logger.logCircuitBreaker(backendId: string, oldState: string, newState: string, context?: LogContext)
```

**Production Mode Output:**
```
[WARN] [circuit-breaker] Circuit breaker: backend-1 closed → open { backendId: 'backend-1', oldState: 'closed', newState: 'open' }
```

**Debug Mode Output:**
```
[DEBUG] [circuit-breaker] Circuit breaker state change: closed → open {
  backendId: 'backend-1',
  oldState: 'closed',
  newState: 'open',
  timestamp: 1754014019477
}
```

### Performance Logging

```typescript
logger.logPerformance(operation: string, duration: number, context?: LogContext)
```

**Production Mode Output:**
```
[WARN] [performance] Slow operation: database query took 2500ms { operation: 'database query', duration: 2500 }
```

**Debug Mode Output:**
```
[DEBUG] [performance] Performance: health check took 50ms {
  operation: 'health check',
  duration: 50,
  timestamp: 1754014019477
}
```

### Configuration Change Logging

```typescript
logger.logConfigChange(changeType: string, details: any, context?: LogContext)
```

**Production Mode Output:**
```
[INFO] [config] Configuration updated: backend added { changeType: 'backend added' }
```

**Debug Mode Output:**
```
[DEBUG] [config] Configuration change: backend added {
  changeType: 'backend added',
  details: { backendId: 'backend-3', url: 'https://backend3.example.com' },
  timestamp: 1754014019477
}
```

## Integration Points

### Main Worker (`src/index.ts`)

- Request/response logging for all incoming requests
- DNS resolution logging and fallback events
- Admin API request logging
- Scheduled task logging

### Durable Object (`src/durable-object.ts`)

- Backend selection logging
- Health check logging
- Circuit breaker state changes
- Configuration and metrics updates
- Error handling and recovery

### Load Balancer Utils (`src/load-balancer-utils.ts`)

- Algorithm selection logging
- Session affinity events
- High availability decisions

### Config Parser (`src/config-parser.ts`)

- Configuration parsing and validation
- Wildcard expansion logging

## Log Context Structure

All logging methods accept an optional `LogContext` object:

```typescript
interface LogContext {
  serviceId?: string;
  backendId?: string;
  requestId?: string;
  clientIp?: string;
  userAgent?: string;
  url?: string;
  method?: string;
  statusCode?: number;
  duration?: number;
  error?: Error | string;
  [key: string]: any;  // Additional custom fields
}
```

## Child Loggers

Create child loggers with additional context:

```typescript
const childLogger = logger.child({ 
  serviceId: 'api-service',
  requestId: 'req-123' 
});

// All logs from childLogger will include the additional context
childLogger.info('Processing request', { step: 'validation' });
// Output: [INFO] [api-service] Processing request { serviceId: 'api-service', requestId: 'req-123', step: 'validation' }
```

## Testing

Run the logging test to verify functionality:

```bash
node test/logging-test.js
```

This test demonstrates:
- Different verbosity levels based on DEBUG setting
- All specialized logging methods
- Error scenario logging
- Context propagation

## Best Practices

### Production Deployment

1. Set `DEBUG=false` in production for minimal log volume
2. Monitor error and warning logs for issues
3. Use structured logging for automated analysis

### Development and Debugging

1. Set `DEBUG=true` for comprehensive logging
2. Use context objects to add relevant information
3. Monitor performance logs for slow operations

### Log Analysis

1. Use structured logging for automated parsing
2. Monitor error rates and response times
3. Track circuit breaker state changes
4. Analyze fallback patterns

## Log Format

All logs follow this format:

```
[TIMESTAMP] [LEVEL] [SERVICE_ID] MESSAGE { CONTEXT_OBJECT }
```

Example:
```
[2025-01-30T10:30:15.123Z] [INFO] [main-worker] Request: GET /api/users { clientIp: '192.168.1.1', hostname: 'example.com' }
```

## Performance Considerations

- Debug logs are only processed when `DEBUG=true`
- Context objects are only serialized in debug mode
- Logging overhead is minimal in production mode
- Structured logging enables efficient log aggregation and analysis 