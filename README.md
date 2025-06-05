# Cloudflare Workers Load Balancer

A enterprise-grade, multi-service load balancer built with Cloudflare Workers and Durable Objects. Provides dynamic backend configuration, session affinity, health checking, and real-time metrics - all without requiring redeployment.

## Features

- **Multi-Service Support**: Handle load balancing for unlimited services/domains from a single worker deployment
- **Dynamic Configuration**: Add, remove, and configure backends via secure API calls - no redeployment needed
- **Load Balancing Algorithms**:
  - Round-robin (default)
  - Weighted round-robin
  - Session affinity (IP-based or cookie-based)
- **Health Monitoring**:
  - Passive health checks (based on request failures)
  - Active health checks (periodic probes to `/healthz` or custom endpoints)
  - Automatic backend revival after failure timeout
- **Advanced Proxying**:
  - WebSocket support
  - Intelligent retry logic for non-idempotent methods
  - Header forwarding and manipulation
  - Configurable Host header rewriting
- **Real-time Metrics**: Human-friendly dashboard showing backend health, request counts, response times, and failure rates
- **Secure API**: Protected configuration API for runtime updates
- **Industry Standards**: Follows nginx-style configuration patterns and load balancing best practices

## Quick Start

### 1. Deploy to Cloudflare Workers

```bash
# Set your API secret (use a strong random value)
wrangler secret put API_SECRET

# Deploy the worker
wrangler deploy
```

### 2. Configure Your First Service

**Important**: The worker starts with NO pre-configured services. You must configure each service via the API before it can handle traffic.

```bash
# Example: Configure backends for example.com
curl -X POST https://your-worker.your-subdomain.workers.dev/admin/services/example.com/config \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "backends": [
      { "id": "primary", "url": "https://backend1.example.com", "weight": 1 },
      { "id": "secondary", "url": "https://backend2.example.com", "weight": 1 }
    ],
    "sessionAffinity": { "type": "ip" },
    "activeHealthChecks": {
      "enabled": true,
      "path": "/health",
      "intervalMs": 30000
    }
  }'
```

### 3. Route Traffic

Point your domain's DNS to the worker:
- **DNS A/AAAA Record**: Point to Cloudflare Worker custom domain, OR
- **DNS CNAME**: Point to `your-worker.your-subdomain.workers.dev`

The worker automatically creates separate Durable Object instances for each hostname, ensuring complete isolation between services.

## Configuration API

### View Current Configuration

```bash
curl -H "Authorization: Bearer YOUR_API_SECRET" \
  https://your-worker.workers.dev/__lb_admin__/aiostreams.bolabaden.org/config
```

### Update Configuration

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "backends": [
      {"id": "primary", "url": "https://primary.example.com", "weight": 2},
      {"id": "secondary", "url": "https://secondary.example.com", "weight": 1}
    ],
    "sessionAffinity": {
      "type": "cookie",
      "cookieName": "lb_backend",
      "cookieTTLSeconds": 3600
    },
    "passiveHealthChecks": {
      "maxFailures": 3,
      "failureTimeoutMs": 30000,
      "retryableStatusCodes": [500, 502, 503, 504]
    },
    "activeHealthChecks": {
      "enabled": true,
      "path": "/health",
      "intervalMs": 30000,
      "timeoutMs": 5000,
      "expectedStatusCode": 200
    },
    "retryPolicy": {"maxRetries": 2},
    "hostHeaderRewrite": "preserve"
  }' \
  https://your-worker.workers.dev/__lb_admin__/aiostreams.bolabaden.org/config
```

### Configuration Options

- **backends**: Array of backend servers
  - `id`: Unique identifier
  - `url`: Full URL to the backend
  - `weight`: Weight for weighted round-robin (default: 1)
  - `healthy`: Current health status (managed automatically)

- **sessionAffinity**: Session stickiness configuration
  - `type`: `"none"`, `"cookie"`, or `"ip"`
  - `cookieName`: Cookie name for cookie-based affinity
  - `cookieTTLSeconds`: Cookie TTL in seconds

- **passiveHealthChecks**: Failure-based health monitoring
  - `maxFailures`: Max consecutive failures before marking unhealthy
  - `failureTimeoutMs`: How long to wait before retrying an unhealthy backend
  - `retryableStatusCodes`: HTTP status codes that trigger retries

- **activeHealthChecks**: Proactive health monitoring
  - `enabled`: Enable/disable active checks
  - `path`: Health check endpoint path
  - `intervalMs`: Time between health checks
  - `timeoutMs`: Request timeout for health checks
  - `expectedStatusCode`: Expected HTTP status code (default: 200)

- **retryPolicy**: Request retry configuration
  - `maxRetries`: Maximum retry attempts for failed requests

- **hostHeaderRewrite**: How to handle the Host header
  - `"preserve"`: Keep original Host header
  - `"backend_hostname"`: Use backend's hostname
  - Custom string: Use specific value

## Metrics Dashboard

### HTML Dashboard

```bash
curl -H "Authorization: Bearer YOUR_API_SECRET" \
  https://your-worker.workers.dev/__lb_metrics__/aiostreams.bolabaden.org/html
```

### JSON Metrics

```bash
curl -H "Authorization: Bearer YOUR_API_SECRET" \
  https://your-worker.workers.dev/__lb_metrics__/aiostreams.bolabaden.org/json
```

The dashboard shows:

- Total requests processed
- Success/failure rates per backend
- Average response times
- Current backend health status
- Recent failure timestamps

## Adding New Services

To add a new service (e.g., `dozzle.bolabaden.org`):

1. **Set up DNS** to point to your worker
2. **Configure backends**:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "backends": [
      {"id": "dozzle-main", "url": "https://dozzle-main.example.com"},
      {"id": "dozzle-backup", "url": "https://dozzle-backup.example.com"}
    ],
    "sessionAffinity": {"type": "ip"},
    "activeHealthChecks": {
      "enabled": true,
      "path": "/",
      "intervalMs": 60000
    }
  }' \
  https://your-worker.workers.dev/__lb_admin__/dozzle.bolabaden.org/config
```

## WebSocket Support

The load balancer automatically handles WebSocket upgrade requests and forwards them to the appropriate backend while maintaining session affinity.

## Security

- API endpoints are protected with Bearer token authentication
- Admin/metrics paths use unique prefixes (`/__lb_admin__/`, `/__lb_metrics__/`) that won't conflict with your applications
- Request validation prevents open proxy attacks

## Monitoring and Debugging

The worker provides extensive logging:

- Request routing decisions
- Backend health changes
- Retry attempts and failures
- Performance metrics

Check your Cloudflare Workers logs for detailed information about load balancer behavior.

## Nginx Configuration Compatibility

This implementation replicates the behavior of the provided `nginx.conf`:

- IP-based session affinity (equivalent to `ip_hash`)
- Passive health checks (equivalent to `max_fails` and `fail_timeout`)
- Retry logic (equivalent to `proxy_next_upstream`)
- Header forwarding (`X-Forwarded-For`, `X-Real-IP`, etc.)

## Development

### Project Structure

```
src/
├── index.ts           # Main worker entry point
├── durable-object.ts  # Load balancer logic and state management
└── types.ts          # TypeScript interfaces

wrangler.jsonc        # Cloudflare Workers configuration
```

### Local Development

```bash
# Install dependencies
npm install

# Start local development server
wrangler dev

# Test with local configuration
curl -H "Authorization: Bearer bc0d037f84a54300811498e705716b6ed601f52209524a06b1eaa668904f60bc" \
  http://localhost:8787/__lb_metrics__/aiostreams.bolabaden.org/html
```

## TODO Checklist

All major TODO items have been implemented:

- ✅ Round-robin algorithm with weighted support
- ✅ Session stickiness (IP and cookie-based)
- ✅ Comprehensive request proxying with WebSocket support
- ✅ Durable Object state management
- ✅ Dynamic backend management
- ✅ Worker consistency across instances
- ✅ Intelligent timeout and retry handling
- ✅ Comprehensive observability
- ✅ Graceful failover with health tracking

## License

This project is open source. See LICENSE file for details.

curl -H "Authorization: Bearer YOUR_API_SECRET" \
  https://your-worker.workers.dev/__lb_metrics__/aiostreams.bolabaden.org/json
```

The dashboard shows:

- Total requests processed
- Success/failure rates per backend
- Average response times
- Current backend health status
- Recent failure timestamps

## Adding New Services

To add a new service (e.g., `dozzle.bolabaden.org`):

1. **Set up DNS** to point to your worker
2. **Configure backends**:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "backends": [
      {"id": "dozzle-main", "url": "https://dozzle-main.example.com"},
      {"id": "dozzle-backup", "url": "https://dozzle-backup.example.com"}
    ],
    "sessionAffinity": {"type": "ip"},
    "activeHealthChecks": {
      "enabled": true,
      "path": "/",
      "intervalMs": 60000
    }
  }' \
  https://your-worker.workers.dev/__lb_admin__/dozzle.bolabaden.org/config
```

## WebSocket Support

The load balancer automatically handles WebSocket upgrade requests and forwards them to the appropriate backend while maintaining session affinity.

## Security

- API endpoints are protected with Bearer token authentication
- Admin/metrics paths use unique prefixes (`/__lb_admin__/`, `/__lb_metrics__/`) that won't conflict with your applications
- Request validation prevents open proxy attacks

## Monitoring and Debugging

The worker provides extensive logging:

- Request routing decisions
- Backend health changes
- Retry attempts and failures
- Performance metrics

Check your Cloudflare Workers logs for detailed information about load balancer behavior.

## Nginx Configuration Compatibility

This implementation replicates the behavior of the provided `nginx.conf`:

- IP-based session affinity (equivalent to `ip_hash`)
- Passive health checks (equivalent to `max_fails` and `fail_timeout`)
- Retry logic (equivalent to `proxy_next_upstream`)
- Header forwarding (`X-Forwarded-For`, `X-Real-IP`, etc.)

## Development

### Project Structure

```
src/
├── index.ts           # Main worker entry point
├── durable-object.ts  # Load balancer logic and state management
└── types.ts          # TypeScript interfaces

wrangler.jsonc        # Cloudflare Workers configuration
```

### Local Development

```bash
# Install dependencies
npm install

# Start local development server
wrangler dev

# Test with local configuration
curl -H "Authorization: Bearer bc0d037f84a54300811498e705716b6ed601f52209524a06b1eaa668904f60bc" \
  http://localhost:8787/__lb_metrics__/aiostreams.bolabaden.org/html
```

## TODO Checklist

All major TODO items have been implemented:

- ✅ Round-robin algorithm with weighted support
- ✅ Session stickiness (IP and cookie-based)
- ✅ Comprehensive request proxying with WebSocket support
- ✅ Durable Object state management
- ✅ Dynamic backend management
- ✅ Worker consistency across instances
- ✅ Intelligent timeout and retry handling
- ✅ Comprehensive observability
- ✅ Graceful failover with health tracking

## License

This project is open source. See LICENSE file for details.
>>>>>>> d39a924 (Initial Commit)
