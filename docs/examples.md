# API Examples and Use Cases

## Quick Start Examples

### 1. Basic Load Balancer Setup

**Initial Configuration (Environment Variable)**

```bash
export DEFAULT_BACKENDS='api.example.com|https://backend1.example.com,https://backend2.example.com'
```

**Check Service Status**

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/list
```

**Get Service Configuration**

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/config
```

### 2. Add Session Affinity

**Enable Cookie-Based Session Affinity**

```bash
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "load_balancer": {
         "session_affinity": {
           "enabled": true,
           "type": "cookie",
           "cookieName": "app_session",
           "timeout": 3600,
           "cookieSecure": true,
           "cookieHttpOnly": true
         }
       }
     }' \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/config
```

### 3. Configure Health Checks

**Enable Active Health Checks**

```bash
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "activeHealthChecks": {
         "enabled": true,
         "path": "/health",
         "interval": 30,
         "timeout": 5,
         "expected_codes": [200, 204],
         "consecutive_up": 2,
         "consecutive_down": 3
       }
     }' \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/config
```

## Advanced Configuration Examples

### 1. High Availability Setup

**Configure N+1 Redundancy with Circuit Breakers**

```bash
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "load_balancer": {
         "loadBalancingAlgorithm": "weighted_round_robin",
         "circuitBreaker": {
           "enabled": true,
           "failureThreshold": 5,
           "recoveryTimeout": 60000,
           "halfOpenMaxRequests": 3
         }
       },
       "highAvailability": {
         "enabled": true,
         "mode": "n_plus_1",
         "minimum_healthy_backends": 2,
         "failover_strategy": "graceful",
         "drain_timeout": 30000
       },
       "retryPolicy": {
         "max_retries": 3,
         "backoff_strategy": "exponential",
         "base_delay": 1000,
         "circuit_breaker_aware": true
       }
     }' \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/config
```

### 2. Performance Optimization

**Configure Least Connections with Response Time Monitoring**

```bash
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "load_balancer": {
         "loadBalancingAlgorithm": "least_connections"
       },
       "passiveHealthChecks": {
         "enabled": true,
         "response_time_threshold": 2000,
         "error_rate_threshold": 0.1,
         "window_size": 300000
       },
       "observability": {
         "collect_metrics": true,
         "log_level": "info",
         "add_backend_header": true
       }
     }' \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/config
```

### 3. Backend Management

**Add a New Backend**

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://backend3.example.com",
       "weight": 2,
       "priority": 5,
       "enabled": true,
       "poolId": "main-pool"
     }' \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends
```

**Update Backend Weight**

```bash
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "weight": 3,
       "priority": 1
     }' \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends/backend-1
```

**Disable a Backend**

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends/backend-1/disable
```

### 4. Monitoring and Metrics

**Get Comprehensive Metrics**

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/metrics
```

**Trigger Manual Health Check**

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/health/check
```

**Reset Backend Health**

```bash
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends/backend-1/health/reset
```

## Use Case Examples

### 1. E-commerce Application

**Requirements:**

- Session affinity for shopping carts
- High availability with failover
- Performance monitoring
- Health checks

**Configuration:**

```bash
# Initial setup
export DEFAULT_BACKENDS='shop.example.com|https://shop1.example.com,https://shop2.example.com,https://shop3.example.com'

# Configure session affinity and HA
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "load_balancer": {
         "loadBalancingAlgorithm": "least_connections",
         "session_affinity": {
           "enabled": true,
           "type": "cookie",
           "cookieName": "cart_session",
           "timeout": 7200,
           "persistence": "strict"
         },
         "circuitBreaker": {
           "enabled": true,
           "failureThreshold": 3,
           "recoveryTimeout": 30000
         }
       },
       "highAvailability": {
         "enabled": true,
         "mode": "active_active",
         "minimum_healthy_backends": 2
       },
       "activeHealthChecks": {
         "enabled": true,
         "path": "/health",
         "interval": 15,
         "timeout": 3
       },
       "observability": {
         "collect_metrics": true,
         "log_level": "info",
         "add_backend_header": true
       }
     }' \
     https://your-worker.your-subdomain.workers.dev/admin/shop.example.com/config
```

### 2. API Gateway

**Requirements:**

- Multiple API versions
- Rate limiting
- Response time optimization
- Comprehensive monitoring

**Configuration:**

```bash
# Setup for API v1
export DEFAULT_BACKENDS='api-v1.example.com|https://api1-v1.example.com,https://api2-v1.example.com'

# Configure for API gateway
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "load_balancer": {
         "loadBalancingAlgorithm": "response_time",
         "rateLimiting": {
           "enabled": true,
           "requestsPerSecond": 1000,
           "burstSize": 2000,
           "keyBy": "ip"
         }
       },
       "passiveHealthChecks": {
         "enabled": true,
         "response_time_threshold": 1000,
         "error_rate_threshold": 0.05
       },
       "retryPolicy": {
         "max_retries": 2,
         "backoff_strategy": "exponential",
         "retry_on_5xx": true
       },
       "observability": {
         "collect_metrics": true,
         "log_level": "debug",
         "tracing_enabled": true
       }
     }' \
     https://your-worker.your-subdomain.workers.dev/admin/api-v1.example.com/config
```

### 3. Microservices Load Balancer

**Requirements:**

- Service discovery integration
- Health checks for each service
- Circuit breakers
- Metrics aggregation

**Configuration:**

```bash
# Setup for user service
export DEFAULT_BACKENDS='users.example.com|https://users-service-1.example.com,https://users-service-2.example.com'

# Configure microservice load balancer
curl -X PUT \
     -H "Authorization: Bearer your-api-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "load_balancer": {
         "loadBalancingAlgorithm": "round_robin",
         "circuitBreaker": {
           "enabled": true,
           "failureThreshold": 5,
           "recoveryTimeout": 60000
         }
       },
       "activeHealthChecks": {
         "enabled": true,
         "path": "/health",
         "interval": 10,
         "timeout": 2,
         "expected_codes": [200],
         "expected_body": "healthy"
       },
       "passiveHealthChecks": {
         "enabled": true,
         "max_failures": 3,
         "failure_timeout_ms": 30000
       },
       "observability": {
         "collect_metrics": true,
         "log_level": "info",
         "add_backend_header": true,
         "request_id_header": "X-Request-ID"
       }
     }' \
     https://your-worker.your-subdomain.workers.dev/admin/users.example.com/config
```

## Scripts and Automation

### 1. Health Check Monitoring Script

```bash
#!/bin/bash

API_SECRET="your-api-secret"
WORKER_URL="https://your-worker.your-subdomain.workers.dev"
SERVICE="api.example.com"

# Check health status
health_response=$(curl -s -H "Authorization: Bearer $API_SECRET" \
     "$WORKER_URL/admin/$SERVICE/health")

# Parse health data
healthy_backends=$(echo $health_response | jq -r '.data.summary.healthyBackends')
total_backends=$(echo $health_response | jq -r '.data.summary.totalBackends')

echo "Health Status: $healthy_backends/$total_backends backends healthy"

# Alert if unhealthy
if [ $healthy_backends -lt $total_backends ]; then
    echo "WARNING: Some backends are unhealthy!"
    echo $health_response | jq -r '.data.backends[] | select(.healthy == false) | "Unhealthy: \(.url) - \(.status)"'
fi
```

### 2. Configuration Backup Script

```bash
#!/bin/bash

API_SECRET="your-api-secret"
WORKER_URL="https://your-worker.your-subdomain.workers.dev"
BACKUP_DIR="./backups"

mkdir -p $BACKUP_DIR

# Get list of services
services_response=$(curl -s -H "Authorization: Bearer $API_SECRET" \
     "$WORKER_URL/admin/list")

# Backup each service configuration
echo $services_response | jq -r '.data.services | keys[]' | while read service; do
    echo "Backing up configuration for $service"
    
    config_response=$(curl -s -H "Authorization: Bearer $API_SECRET" \
         "$WORKER_URL/admin/$service/config")
    
    echo $config_response | jq '.data' > "$BACKUP_DIR/${service}_config_$(date +%Y%m%d_%H%M%S).json"
done

echo "Backup completed in $BACKUP_DIR"
```

### 3. Load Testing Script

```bash
#!/bin/bash

SERVICE_URL="https://api.example.com"
REQUESTS=1000
CONCURRENT=10

echo "Starting load test: $REQUESTS requests with $CONCURRENT concurrent connections"

# Run load test with curl
curl -s -o /dev/null -w "Total time: %{time_total}s\n" \
     -H "X-Load-Test: true" \
     --max-time 30 \
     "$SERVICE_URL/health"

# Use ab (Apache Bench) if available
if command -v ab &> /dev/null; then
    ab -n $REQUESTS -c $CONCURRENT "$SERVICE_URL/health"
else
    echo "Apache Bench not available. Install with: apt-get install apache2-utils"
fi
```

### 4. Metrics Collection Script

```bash
#!/bin/bash

API_SECRET="your-api-secret"
WORKER_URL="https://your-worker.your-subdomain.workers.dev"
SERVICE="api.example.com"
METRICS_FILE="./metrics_$(date +%Y%m%d_%H%M%S).json"

# Collect metrics
metrics_response=$(curl -s -H "Authorization: Bearer $API_SECRET" \
     "$WORKER_URL/admin/$SERVICE/metrics")

# Save to file
echo $metrics_response | jq '.data' > $METRICS_FILE

# Display summary
echo "Metrics Summary:"
echo "Total Requests: $(echo $metrics_response | jq -r '.data.totalRequests')"
echo "Success Rate: $(echo $metrics_response | jq -r '(.data.totalSuccessfulRequests / .data.totalRequests * 100) | round')%"
echo "Healthy Backends: $(echo $metrics_response | jq -r '.data.highAvailabilityMetrics.healthyBackendCount')"

echo "Full metrics saved to: $METRICS_FILE"
```

## Integration Examples

### 1. Prometheus Metrics Export

```bash
#!/bin/bash

API_SECRET="your-api-secret"
WORKER_URL="https://your-worker.your-subdomain.workers.dev"
PROMETHEUS_PORT=9090

# Start Prometheus metrics endpoint
while true; do
    # Get metrics from all services
    services_response=$(curl -s -H "Authorization: Bearer $API_SECRET" \
         "$WORKER_URL/admin/list")
    
    # Convert to Prometheus format
    echo "# HELP loadbalancer_requests_total Total requests"
    echo "# TYPE loadbalancer_requests_total counter"
    
    echo $services_response | jq -r '.data.services | to_entries[] | "loadbalancer_requests_total{service=\"\(.key)\"} \(.value.metrics.totalRequests // 0)"'
    
    echo "# HELP loadbalancer_healthy_backends Number of healthy backends"
    echo "# TYPE loadbalancer_healthy_backends gauge"
    
    echo $services_response | jq -r '.data.services | to_entries[] | "loadbalancer_healthy_backends{service=\"\(.key)\"} \(.value.metrics.healthyBackends // 0)"'
    
    sleep 15
done | nc -l $PROMETHEUS_PORT
```

### 2. Slack Notifications

```bash
#!/bin/bash

SLACK_WEBHOOK="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
API_SECRET="your-api-secret"
WORKER_URL="https://your-worker.your-subdomain.workers.dev"
SERVICE="api.example.com"

# Check health and send notification
health_response=$(curl -s -H "Authorization: Bearer $API_SECRET" \
     "$WORKER_URL/admin/$SERVICE/health")

unhealthy_count=$(echo $health_response | jq -r '.data.summary.unhealthyBackends')

if [ $unhealthy_count -gt 0 ]; then
    message="🚨 Load Balancer Alert: $unhealthy_count unhealthy backends for $SERVICE"
    
    curl -X POST -H 'Content-type: application/json' \
         --data "{\"text\":\"$message\"}" \
         $SLACK_WEBHOOK
fi
```

### 3. Kubernetes Integration

```yaml
# kubernetes-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: loadbalancer-config
data:
  DEFAULT_BACKENDS: |
    api.example.com|https://backend1.example.com,https://backend2.example.com
  API_SECRET: "your-api-secret"
```

```yaml
# kubernetes-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: loadbalancer-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: loadbalancer-worker
  template:
    metadata:
      labels:
        app: loadbalancer-worker
    spec:
      containers:
      - name: loadbalancer
        image: cloudflare/loadbalancer-worker:latest
        envFrom:
        - configMapRef:
            name: loadbalancer-config
        ports:
        - containerPort: 8080
```

## Troubleshooting Examples

### 1. Debug Session Affinity Issues

```bash
# Check session configuration
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/config | \
     jq '.data.load_balancer.session_affinity'

# Check session metrics
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/metrics | \
     jq '.data.sessionMetrics'

# Clear sessions if needed
curl -X DELETE \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/sessions
```

### 2. Debug Health Check Issues

```bash
# Check health status
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/health

# Trigger manual health check
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/health/check

# Reset backend health
curl -X POST \
     -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/backends/backend-1/health/reset
```

### 3. Performance Analysis

```bash
# Get detailed metrics
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/metrics | \
     jq '.data.backendMetrics'

# Check response times
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/api.example.com/metrics | \
     jq '.data.backendMetrics | to_entries[] | "\(.key): \(.value.avgResponseTimeMs)ms"'
```
