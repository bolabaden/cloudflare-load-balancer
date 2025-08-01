# Configuration Schema Reference

## Overview

The Cloudflare Load Balancer uses a comprehensive JSON configuration schema that supports advanced load balancing features, health checks, session affinity, and high availability configurations.

## Configuration Structure

```json
{
  "services": [
    {
      "hostname": "api.example.com",
      "backends": [
        "https://backend1.example.com",
        "https://backend2.example.com"
      ]
    }
  ]
}
```

## Service Configuration

### Basic Service Configuration

```json
{
  "hostname": "api.example.com",
  "backends": [
    "https://backend1.example.com",
    "https://backend2.example.com"
  ]
}
```

### Wildcard Service Configuration

```json
{
  "hostname": "*.example.com",
  "backends": [
    "https://*.backend1.example.com",
    "https://*.backend2.example.com"
  ]
}
```

## Advanced Configuration Schema

The load balancer supports advanced configuration through the admin API. Here's the complete schema:

### Load Balancer Configuration

```json
{
  "load_balancer": {
    "id": "main-lb",
    "name": "Main Load Balancer",
    "hostname": "api.example.com",
    "default_pool_ids": ["main-pool"],
    "proxied": true,
    "enabled": true,
    "steering_policy": "off",
    "loadBalancingAlgorithm": "round_robin",
    "session_affinity": {
      "type": "cookie",
      "enabled": true,
      "persistence": "preferred",
      "timeout": 3600,
      "gracefulDegradation": true,
      "cookieName": "lb_session",
      "cookieSecure": true,
      "cookieHttpOnly": true,
      "cookieSameSite": "Lax",
      "cookiePath": "/",
      "cookieDomain": ".example.com"
    },
    "circuitBreaker": {
      "enabled": true,
      "failureThreshold": 5,
      "recoveryTimeout": 60000,
      "halfOpenMaxRequests": 3,
      "monitoringWindow": 60000
    },
    "rateLimiting": {
      "enabled": false,
      "requestsPerSecond": 100,
      "burstSize": 200,
      "keyBy": "ip"
    },
    "connectionPooling": {
      "enabled": false,
      "maxConnections": 100,
      "maxIdleTime": 30000,
      "connectionTimeout": 5000
    }
  }
}
```

### Load Balancing Algorithms

| Algorithm | Description | Use Case |
|-----------|-------------|----------|
| `round_robin` | Distributes requests evenly | General purpose |
| `weighted_round_robin` | Distributes based on weights | Uneven capacity backends |
| `least_connections` | Routes to backend with fewest connections | Connection-heavy workloads |
| `weighted_least_connections` | Considers both connections and weights | Advanced connection balancing |
| `ip_hash` | Consistent hashing based on client IP | Session affinity by IP |
| `url_hash` | Consistent hashing based on URL | Cache-friendly routing |
| `response_time` | Routes to fastest responding backend | Performance optimization |
| `availability` | Routes to most available backend | High availability |
| `random` | Random selection | Simple load distribution |

### Session Affinity Types

| Type | Description | Configuration |
|------|-------------|---------------|
| `none` | No session affinity | Default |
| `cookie` | Cookie-based sticky sessions | Requires `cookieName` |
| `ip_cookie` | IP-based sticky sessions | Automatic |
| `header` | Header-based sticky sessions | Requires `headerName` |
| `jwt` | JWT claim-based sessions | Requires `jwtClaim` and `jwtSecret` |
| `custom` | Custom key-based sessions | Requires `customKey` |

### Session Affinity Persistence Levels

| Level | Description |
|-------|-------------|
| `strict` | Always use sticky backend, fail if unavailable |
| `preferred` | Use sticky backend if available, fallback otherwise |
| `adaptive` | Dynamically adjust based on backend health |

### Origin Pool Configuration

```json
{
  "pools": [
    {
      "id": "main-pool",
      "name": "Main Pool",
      "backends": [
        {
          "id": "backend-1",
          "url": "https://backend1.example.com",
          "ip": "backend1.example.com",
          "weight": 1,
          "healthy": true,
          "consecutiveFailures": 0,
          "consecutiveSuccesses": 100,
          "requests": 750,
          "successfulRequests": 725,
          "failedRequests": 25,
          "totalResponseTimeMs": 15000,
          "priority": 10,
          "enabled": true,
          "circuitBreakerState": "closed",
          "circuitBreakerFailures": 0,
          "circuitBreakerThreshold": 5,
          "circuitBreakerTimeout": 60000
        }
      ],
      "enabled": true,
      "minimum_origins": 1,
      "endpoint_steering": "round_robin",
      "failoverEnabled": false,
      "failoverThreshold": 3,
      "healthCheckAggregation": "any",
      "healthCheckQuorum": 1
    }
  ]
}
```

### Endpoint Steering Options

| Option | Description |
|--------|-------------|
| `round_robin` | Standard round-robin distribution |
| `random` | Random selection |
| `hash` | Hash-based distribution |
| `least_connections` | Least connections selection |
| `weighted_least_connections` | Weighted least connections |
| `response_time` | Response time-based selection |
| `availability` | Availability-based selection |

### Health Check Configuration

#### Active Health Checks

```json
{
  "activeHealthChecks": {
    "enabled": true,
    "type": "http",
    "path": "/health",
    "method": "GET",
    "timeout": 5,
    "interval": 30,
    "retries": 1,
    "expected_codes": [200, 204],
    "expected_body": "healthy",
    "follow_redirects": false,
    "consecutive_up": 2,
    "consecutive_down": 3,
    "grace_period": 30,
    "unhealthy_threshold": 3,
    "healthy_threshold": 2,
    "headers": {
      "User-Agent": "Cloudflare-LoadBalancer/1.0"
    },
    "scheduling": {
      "type": "fixed",
      "adaptive_interval_min": 30,
      "adaptive_interval_max": 300,
      "adaptive_success_factor": 1.5,
      "adaptive_failure_factor": 0.5
    }
  }
}
```

#### Passive Health Checks

```json
{
  "passiveHealthChecks": {
    "enabled": true,
    "max_failures": 3,
    "failure_timeout_ms": 30000,
    "retryable_status_codes": [500, 502, 503, 504],
    "monitor_timeout": 10,
    "success_threshold": 2,
    "window_size": 300000,
    "error_rate_threshold": 0.5,
    "response_time_threshold": 5000,
    "failure_patterns": {
      "status_codes": [500, 502, 503, 504],
      "response_headers": {
        "X-Error": "true"
      },
      "response_body_patterns": ["error", "timeout"],
      "timeout_threshold": 10000
    },
    "auto_recovery": true,
    "recovery_threshold": 2,
    "recovery_timeout": 60000
  }
}
```

### Retry Policy Configuration

```json
{
  "retryPolicy": {
    "max_retries": 2,
    "retry_timeout": 10000,
    "backoff_strategy": "exponential",
    "base_delay": 1000,
    "max_delay": 30000,
    "jitter_factor": 0.1,
    "retryable_methods": ["GET", "HEAD", "OPTIONS"],
    "retryable_status_codes": [500, 502, 503, 504],
    "retryable_errors": ["timeout", "connection_error"],
    "retry_on_timeout": true,
    "retry_on_connection_error": true,
    "retry_on_5xx": true,
    "retry_on_4xx": false,
    "retry_after_header": "Retry-After",
    "retry_count_header": "X-Retry-Count",
    "circuit_breaker_aware": true
  }
}
```

### Backoff Strategies

| Strategy | Description | Formula |
|----------|-------------|---------|
| `constant` | Fixed delay | `base_delay` |
| `exponential` | Exponential backoff | `base_delay * 2^attempt` |
| `linear` | Linear increase | `base_delay * attempt` |
| `jitter` | Exponential with jitter | `base_delay * 2^attempt * (1 ± jitter_factor)` |

### High Availability Configuration

```json
{
  "highAvailability": {
    "enabled": true,
    "mode": "active_active",
    "minimum_healthy_backends": 1,
    "failover_strategy": "immediate",
    "drain_timeout": 30000,
    "health_check_aggregation": "any",
    "health_check_quorum": 1,
    "geo_failover": {
      "enabled": false,
      "regions": ["us-east-1", "us-west-2"],
      "preferred_region": "us-east-1",
      "failover_order": ["us-east-1", "us-west-2", "eu-west-1"]
    },
    "load_shedding": {
      "enabled": false,
      "threshold": 0.8,
      "strategy": "reject",
      "max_queue_size": 1000,
      "queue_timeout": 5000
    }
  }
}
```

### High Availability Modes

| Mode | Description | Minimum Backends |
|------|-------------|------------------|
| `active_passive` | One active, one standby | 1 |
| `active_active` | All backends active | 1 |
| `n_plus_1` | N active + 1 standby | N + 1 |
| `n_plus_m` | N active + M standby | N + M |

### Failover Strategies

| Strategy | Description |
|----------|-------------|
| `immediate` | Instant failover |
| `graceful` | Graceful failover with drain |
| `drain` | Drain connections before failover |

### Observability Configuration

```json
{
  "observability": {
    "responseHeaderName": "X-Backend-Used",
    "add_backend_header": true,
    "request_id_header": "X-Request-ID",
    "correlation_id_header": "X-Correlation-ID",
    "backend_response_time_header": "X-Backend-Response-Time",
    "backend_health_header": "X-Backend-Health",
    "collect_metrics": true,
    "metrics_interval": 60,
    "log_level": "info",
    "log_format": "json",
    "log_backend_selection": false,
    "log_health_checks": false,
    "log_retries": false,
    "tracing_enabled": false,
    "trace_id_header": "X-Trace-ID",
    "span_id_header": "X-Span-ID"
  }
}
```

### Log Levels

| Level | Description |
|-------|-------------|
| `debug` | Detailed debug information |
| `info` | General information |
| `warn` | Warning messages |
| `error` | Error messages only |

### Log Formats

| Format | Description |
|--------|-------------|
| `json` | Structured JSON logging |
| `text` | Human-readable text |

## Configuration Examples

### Basic Round Robin Load Balancer

```json
{
  "services": [
    {
      "hostname": "api.example.com",
      "backends": [
        "https://backend1.example.com",
        "https://backend2.example.com",
        "https://backend3.example.com"
      ]
    }
  ]
}
```

### Session Affinity with Health Checks

```json
{
  "services": [
    {
      "hostname": "app.example.com",
      "backends": [
        "https://app1.example.com",
        "https://app2.example.com"
      ]
    }
  ]
}
```

Via Admin API:

```json
{
  "load_balancer": {
    "loadBalancingAlgorithm": "least_connections",
    "session_affinity": {
      "type": "cookie",
      "enabled": true,
      "cookieName": "app_session",
      "timeout": 3600
    }
  },
  "activeHealthChecks": {
    "enabled": true,
    "path": "/health",
    "interval": 30,
    "timeout": 5
  }
}
```

### High Availability with Circuit Breakers

```json
{
  "load_balancer": {
    "loadBalancingAlgorithm": "weighted_round_robin",
    "circuitBreaker": {
      "enabled": true,
      "failureThreshold": 5,
      "recoveryTimeout": 60000
    }
  },
  "highAvailability": {
    "enabled": true,
    "mode": "n_plus_1",
    "minimum_healthy_backends": 2,
    "failover_strategy": "graceful"
  },
  "retryPolicy": {
    "max_retries": 3,
    "backoff_strategy": "exponential",
    "circuit_breaker_aware": true
  }
}
```

### Advanced Monitoring Configuration

```json
{
  "observability": {
    "collect_metrics": true,
    "log_level": "info",
    "log_format": "json",
    "tracing_enabled": true,
    "add_backend_header": true
  },
  "activeHealthChecks": {
    "enabled": true,
    "path": "/health",
    "expected_codes": [200],
    "expected_body": "healthy",
    "headers": {
      "X-Health-Check": "true"
    }
  },
  "passiveHealthChecks": {
    "enabled": true,
    "max_failures": 3,
    "error_rate_threshold": 0.1,
    "response_time_threshold": 2000
  }
}
```

## Environment Variables

The load balancer can be configured using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DEFAULT_BACKENDS` | Default backend configuration | None |
| `API_SECRET` | Admin API authentication secret | Required |
| `DEBUG` | Enable debug logging | false |
| `ENVIRONMENT` | Environment name | production |

## Configuration Validation

The load balancer validates all configuration changes:

- **Backend URLs**: Must be valid HTTP/HTTPS URLs
- **Weights**: Must be positive integers
- **Timeouts**: Must be positive numbers
- **Thresholds**: Must be reasonable values
- **Health Check Paths**: Must be valid paths

## Configuration Persistence

- Configuration is stored in Durable Object storage
- Changes are persisted immediately
- Configuration survives worker restarts
- Backup/restore functionality available via admin API

## Best Practices

### Performance

- Use appropriate load balancing algorithms for your workload
- Configure health checks with reasonable intervals
- Enable circuit breakers for fault tolerance
- Use session affinity sparingly

### Reliability

- Configure multiple backends for redundancy
- Use appropriate failure thresholds
- Enable both active and passive health checks
- Configure retry policies for transient failures

### Monitoring

- Enable comprehensive metrics collection
- Configure appropriate log levels
- Use health check endpoints on backends
- Monitor circuit breaker states

### Security

- Use secure session affinity (HTTPS cookies)
- Configure rate limiting for admin API
- Use strong API secrets
- Enable request tracing for debugging
