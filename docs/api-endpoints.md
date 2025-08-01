# API Endpoints Reference

## Global Endpoints

### List Services

**GET** `/admin/list`

Lists all configured services with their current status and metrics.

#### Response

```json
{
  "success": true,
  "data": {
    "services": {
      "api.example.com": {
        "mode": "wildcard",
        "backends": ["https://backend1.example.com", "https://backend2.example.com"],
        "source": "json",
        "hostname": "*.example.com",
        "backendCount": 2,
        "status": "active",
        "supportsWildcards": true,
        "originalBackends": ["https://*.backend1.example.com", "https://*.backend2.example.com"],
        "metrics": {
          "totalRequests": 1500,
          "totalSuccessfulRequests": 1450,
          "totalFailedRequests": 50,
          "healthyBackends": 2,
          "unhealthyBackends": 0
        },
        "hasLiveData": true
      }
    },
    "count": 1,
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/list
```

---

## Service-Specific Endpoints

### Get Service Configuration

**GET** `/admin/{service}/config`

Retrieves the current configuration for a specific service.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern

#### Response

```json
{
  "success": true,
  "data": {
    "mode": "advanced",
    "serviceId": "api.example.com",
    "backends": ["https://backend1.example.com", "https://backend2.example.com"],
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
    ],
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
        "cookieSameSite": "Lax"
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
    },
    "activeHealthChecks": {
      "enabled": true,
      "path": "/health",
      "interval": 30,
      "timeout": 5,
      "type": "http",
      "consecutive_up": 2,
      "consecutive_down": 3,
      "retries": 1,
      "grace_period": 30,
      "unhealthy_threshold": 3,
      "healthy_threshold": 2,
      "scheduling": {
        "type": "fixed",
        "adaptive_interval_min": 30,
        "adaptive_interval_max": 300,
        "adaptive_success_factor": 1.5,
        "adaptive_failure_factor": 0.5
      }
    },
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
        "timeout_threshold": 10000
      },
      "auto_recovery": true,
      "recovery_threshold": 2,
      "recovery_timeout": 60000
    },
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
    },
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
        "regions": [],
        "failover_order": []
      },
      "load_shedding": {
        "enabled": false,
        "threshold": 0.8,
        "strategy": "reject",
        "max_queue_size": 1000,
        "queue_timeout": 5000
      }
    },
    "observability": {
      "responseHeaderName": "X-Backend-Used",
      "add_backend_header": true,
      "collect_metrics": true,
      "metrics_interval": 60,
      "log_level": "info",
      "log_format": "json",
      "log_backend_selection": false,
      "log_health_checks": false,
      "log_retries": false,
      "tracing_enabled": false
    },
    "source": "custom"
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/config
```

---

### Update Service Configuration

**PUT** `/admin/{service}/config`

Updates the configuration for a specific service. Only the provided fields will be updated.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern

#### Request Body

```json
{
  "load_balancer": {
    "session_affinity": {
      "enabled": true,
      "type": "cookie",
      "cookieName": "lb_session",
      "timeout": 3600
    },
    "loadBalancingAlgorithm": "least_connections"
  },
  "activeHealthChecks": {
    "enabled": true,
    "path": "/health",
    "interval": 30
  },
  "retryPolicy": {
    "max_retries": 3,
    "backoff_strategy": "exponential"
  }
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "message": "Configuration updated successfully",
    "updatedFields": ["load_balancer", "activeHealthChecks", "retryPolicy"],
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Example

```bash
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{"load_balancer":{"session_affinity":{"enabled":true,"type":"cookie"}}}' \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/config
```

---

### Get Backends

**GET** `/admin/{service}/backends`

Retrieves detailed information about all backends for a service.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern

#### Response

```json
{
  "success": true,
  "data": {
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
        "circuitBreakerTimeout": 60000,
        "poolId": "main-pool",
        "poolName": "Main Pool",
        "metrics": {
          "requests": 750,
          "successfulRequests": 725,
          "failedRequests": 25,
          "totalResponseTimeMs": 15000,
          "avgResponseTimeMs": 20.69,
          "concurrentConnections": 5,
          "errorRate": 0.033,
          "availability": 96.67,
          "responseTimePercentiles": {
            "p50": 15,
            "p90": 45,
            "p95": 75,
            "p99": 120
          },
          "circuitBreakerMetrics": {
            "totalFailures": 0,
            "state": "closed"
          }
        }
      }
    ],
    "totalBackends": 1,
    "healthyBackends": 1,
    "unhealthyBackends": 0
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends
```

---

### Add Backend

**POST** `/admin/{service}/backends`

Adds a new backend to a service.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern

#### Request Body

```json
{
  "url": "https://backend3.example.com",
  "weight": 1,
  "priority": 10,
  "enabled": true,
  "poolId": "main-pool"
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "message": "Backend added successfully",
    "backend": {
      "id": "backend-3",
      "url": "https://backend3.example.com",
      "ip": "backend3.example.com",
      "weight": 1,
      "healthy": true,
      "consecutiveFailures": 0,
      "consecutiveSuccesses": 0,
      "requests": 0,
      "successfulRequests": 0,
      "failedRequests": 0,
      "totalResponseTimeMs": 0,
      "priority": 10,
      "enabled": true,
      "circuitBreakerState": "closed",
      "circuitBreakerFailures": 0,
      "circuitBreakerThreshold": 5,
      "circuitBreakerTimeout": 60000
    }
  }
}
```

#### Example

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://backend3.example.com","weight":1,"priority":10,"enabled":true,"poolId":"main-pool"}' \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends
```

---

### Update Backend

**PUT** `/admin/{service}/backends/{backendId}`

Updates an existing backend configuration.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern
- `backendId` (string, required): The backend ID to update

#### Request Body

```json
{
  "weight": 2,
  "priority": 5,
  "enabled": true
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "message": "Backend updated successfully",
    "backend": {
      "id": "backend-1",
      "url": "https://backend1.example.com",
      "weight": 2,
      "priority": 5,
      "enabled": true
    }
  }
}
```

#### Example

```bash
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{"weight":2,"priority":5,"enabled":true}' \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends/backend-1
```

---

### Delete Backend

**DELETE** `/admin/{service}/backends/{backendId}`

Removes a backend from a service.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern
- `backendId` (string, required): The backend ID to remove

#### Response

```json
{
  "success": true,
  "data": {
    "message": "Backend removed successfully",
    "backendId": "backend-1"
  }
}
```

#### Example

```bash
curl -X DELETE \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends/backend-1
```

---

### Enable Backend

**POST** `/admin/{service}/backends/{backendId}/enable`

Enables a disabled backend.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern
- `backendId` (string, required): The backend ID to enable

#### Response

```json
{
  "success": true,
  "data": {
    "message": "Backend enabled successfully",
    "backendId": "backend-1",
    "enabled": true
  }
}
```

#### Example

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends/backend-1/enable
```

---

### Disable Backend

**POST** `/admin/{service}/backends/{backendId}/disable`

Disables a backend (takes it out of rotation).

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern
- `backendId` (string, required): The backend ID to disable

#### Response

```json
{
  "success": true,
  "data": {
    "message": "Backend disabled successfully",
    "backendId": "backend-1",
    "enabled": false
  }
}
```

#### Example

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends/backend-1/disable
```

---

### Get Health Status

**GET** `/admin/{service}/health`

Retrieves the health status of all backends for a service.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern

#### Response

```json
{
  "success": true,
  "data": {
    "summary": {
      "totalBackends": 2,
      "healthyBackends": 1,
      "unhealthyBackends": 1,
      "disabledBackends": 0,
      "activeHealthChecksEnabled": true,
      "passiveHealthChecksEnabled": true
    },
    "backends": [
      {
        "backendId": "backend-1",
        "url": "https://backend1.example.com",
        "poolId": "main-pool",
        "poolName": "Main Pool",
        "healthy": true,
        "consecutiveFailures": 0,
        "lastFailureTimestamp": null,
        "status": "Healthy",
        "enabled": true
      },
      {
        "backendId": "backend-2",
        "url": "https://backend2.example.com",
        "poolId": "main-pool",
        "poolName": "Main Pool",
        "healthy": false,
        "consecutiveFailures": 3,
        "lastFailureTimestamp": "2024-01-01T00:00:00.000Z",
        "status": "Unhealthy (Connection timeout, 3 fails)",
        "enabled": true
      }
    ],
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/health
```

---

### Trigger Health Check

**POST** `/admin/{service}/health/check`

Manually triggers health checks for all backends.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern

#### Response

```json
{
  "success": true,
  "data": {
    "message": "Health checks triggered successfully",
    "backendsChecked": 2,
    "results": [
      {
        "backendId": "backend-1",
        "healthy": true,
        "responseTime": 45,
        "statusCode": 200
      },
      {
        "backendId": "backend-2",
        "healthy": false,
        "error": "Connection timeout",
        "responseTime": null
      }
    ]
  }
}
```

#### Example

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/health/check
```

---

### Reset Backend Health

**POST** `/admin/{service}/backends/{backendId}/health/reset`

Resets the health status of a backend, clearing failure counts and marking it as healthy.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern
- `backendId` (string, required): The backend ID to reset

#### Response

```json
{
  "success": true,
  "data": {
    "message": "Backend health reset successfully",
    "backendId": "backend-1",
    "healthy": true,
    "consecutiveFailures": 0
  }
}
```

#### Example

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends/backend-1/health/reset
```

---

### Get Metrics

**GET** `/admin/{service}/metrics`

Retrieves comprehensive metrics for a service.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern

#### Response

```json
{
  "success": true,
  "data": {
    "serviceId": "api.example.com",
    "totalRequests": 1500,
    "totalSuccessfulRequests": 1450,
    "totalFailedRequests": 50,
    "backendMetrics": {
      "backend-1": {
        "requests": 750,
        "successfulRequests": 725,
        "failedRequests": 25,
        "totalResponseTimeMs": 15000,
        "avgResponseTimeMs": 20.69,
        "concurrentConnections": 5,
        "errorRate": 0.033,
        "availability": 96.67,
        "responseTimePercentiles": {
          "p50": 15,
          "p90": 45,
          "p95": 75,
          "p99": 120
        },
        "circuitBreakerMetrics": {
          "totalFailures": 0,
          "state": "closed"
        }
      }
    },
    "sessionMetrics": {
      "activeSessions": 45,
      "totalSessions": 150,
      "sessionHits": 120,
      "sessionMisses": 30,
      "avgSessionDuration": 1800000
    },
    "loadBalancingMetrics": {
      "backendSelectionCounts": {
        "backend-1": 750
      },
      "loadDistribution": {
        "backend-1": 100
      },
      "responseTimeDistribution": {
        "backend-1": 20.69
      }
    },
    "highAvailabilityMetrics": {
      "failoverEvents": 0,
      "healthyBackendCount": 1,
      "unhealthyBackendCount": 0,
      "availabilityPercentage": 100,
      "haStatus": {
        "available": true,
        "healthyCount": 1,
        "totalCount": 1,
        "mode": "active_active",
        "status": "healthy"
      }
    },
    "circuitBreakerMetrics": {
      "backend-1": {
        "state": "closed",
        "failureCount": 0,
        "successCount": 725,
        "lastFailureTime": null
      }
    }
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/metrics
```

---

### Get Sessions

**GET** `/admin/{service}/sessions`

Retrieves session information for a service.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern

#### Response

```json
{
  "success": true,
  "data": {
    "activeSessions": 45,
    "totalSessions": 150,
    "sessionHits": 120,
    "sessionMisses": 30,
    "avgSessionDuration": 1800000,
    "sessions": [
      {
        "sessionKey": "ip:192.168.1.100",
        "backendId": "backend-1",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "lastAccessed": "2024-01-01T00:30:00.000Z",
        "accessCount": 15,
        "clientInfo": {
          "ip": "192.168.1.100",
          "userAgent": "Mozilla/5.0..."
        }
      }
    ]
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/sessions
```

---

### Clear Sessions

**DELETE** `/admin/{service}/sessions`

Clears all active sessions for a service.

#### Parameters

- `service` (string, required): The service hostname or wildcard pattern

#### Response

```json
{
  "success": true,
  "data": {
    "message": "All sessions cleared successfully",
    "sessionsCleared": 45
  }
}
```

#### Example

```bash
curl -X DELETE \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/sessions
```
