# Cloudflare Load Balancer - Admin API Documentation

## Overview

The Cloudflare Load Balancer provides a comprehensive REST API for managing load balancer configuration, monitoring health, and viewing metrics post-deployment. This API allows you to dynamically modify load balancer settings without requiring redeployment.

## DNS-First Architecture

The load balancer implements a **DNS-first with fallback** architecture:

- **Primary**: DNS resolution handles all normal traffic (2xx, 3xx, 4xx responses)
- **Fallback**: Cloudflare Worker load balancer activates only on server errors (5xx) or network failures
- **Benefits**:
  - DNS handles the majority of traffic efficiently
  - Load balancer only activates when there are actual server problems
  - Seamless failover without service interruption
  - Reduced latency for normal operations

### Environment Variables

- `DNS_FIRST` (default: `true`): Enable DNS-first mode
  - `true` or `1`: Use DNS-first with fallback (recommended)
  - `false` or `0`: Use load balancer directly for all requests

### Response Headers

- `X-LoadBalancer-Source: dns` - Request served via DNS resolution
- `X-LoadBalancer-Source: worker` - Request served via load balancer fallback

## Quick Start

### Base URL

```
https://your-worker.your-subdomain.workers.dev/admin/
```

### Authentication

All admin API endpoints require authentication using the `API_SECRET` environment variable. Include it in the `Authorization` header:

```bash
Authorization: Bearer YOUR_API_SECRET
```

### Example Request

```bash
curl -H "Authorization: Bearer your-api-secret" \
     https://your-worker.your-subdomain.workers.dev/admin/list
```

## API Endpoints

### Health Check

#### GET /health

Check the health status of the load balancer and DNS-first configuration.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": 1704067200000,
  "dnsFirst": true,
  "mode": "dns-first-with-fallback"
}
```

**Response Fields:**

- `status`: Service health status
- `timestamp`: Unix timestamp
- `dnsFirst`: Whether DNS-first mode is enabled
- `mode`: Current load balancer mode (`dns-first-with-fallback` or `load-balancer-only`)

### Global Endpoints

- [`GET /health`](#health-check) - Health check with DNS-first status
- [`GET /admin/list`](#list-services) - List all configured services
- [`GET /admin/{service}/config`](#get-service-config) - Get service configuration
- [`GET /admin/{service}/backends`](#get-backends) - Get backend information
- [`GET /admin/{service}/health`](#get-health-status) - Get health status
- [`GET /admin/{service}/metrics`](#get-metrics) - Get service metrics

### Configuration Management

- [`PUT /admin/{service}/config`](#update-service-config) - Update service configuration
- [`POST /admin/{service}/backends`](#add-backend) - Add new backend
- [`PUT /admin/{service}/backends/{backendId}`](#update-backend) - Update backend
- [`DELETE /admin/{service}/backends/{backendId}`](#delete-backend) - Remove backend
- [`POST /admin/{service}/backends/{backendId}/enable`](#enable-backend) - Enable backend
- [`POST /admin/{service}/backends/{backendId}/disable`](#disable-backend) - Disable backend

### Health Management

- [`POST /admin/{service}/health/check`](#trigger-health-check) - Trigger health check
- [`POST /admin/{service}/backends/{backendId}/health/reset`](#reset-backend-health) - Reset backend health

### Session Management

- [`GET /admin/{service}/sessions`](#get-sessions) - Get session information
- [`DELETE /admin/{service}/sessions`](#clear-sessions) - Clear all sessions

## Response Format

All API responses follow a consistent JSON format:

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional error details",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Rate Limiting

The admin API implements rate limiting to prevent abuse:

- **Default**: 100 requests per minute per IP
- **Burst**: 200 requests per minute
- **Headers**: Rate limit information is included in response headers

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid request format |
| 401 | Unauthorized - Missing or invalid API secret |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Service or resource not found |
| 405 | Method Not Allowed - HTTP method not supported |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error - Server error |

## Configuration Schema

The load balancer uses a comprehensive configuration schema that supports:

- **Multiple Load Balancing Algorithms**: Round Robin, Least Connections, IP Hash, etc.
- **Session Affinity**: Cookie, Header, JWT, and IP-based sticky sessions
- **Health Checks**: Active and passive health monitoring
- **Circuit Breakers**: Automatic failure detection and recovery
- **High Availability**: Multiple HA modes and failover strategies
- **Retry Policies**: Configurable retry logic with backoff strategies

See [Configuration Schema](./configuration-schema.md) for detailed documentation.

## Examples

### Basic Usage Examples

See [Examples](./examples.md) for common use cases and code samples.

### Advanced Configuration

See [Advanced Configuration](./advanced-configuration.md) for complex scenarios.

## Support

For issues and questions:

- Check the [Troubleshooting Guide](./troubleshooting.md)
- Review [Common Issues](./common-issues.md)
- Open an issue on the GitHub repository
