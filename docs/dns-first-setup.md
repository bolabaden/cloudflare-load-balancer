# DNS-First Setup Guide

## Overview

DNS-first functionality means that requests are handled by normal DNS resolution first, and only fall back to the load balancer worker when DNS fails or the backend service is unhealthy.

## How It Works

1. **Normal Operation**: DNS resolves to the actual backend service
2. **DNS Failure**: When DNS resolution fails (NXDOMAIN, SERVFAIL, etc.), requests fall back to the load balancer
3. **Service Failure**: When the backend service is unhealthy (5xx errors, timeouts), requests fall back to the load balancer

## Setup Instructions

### 1. DNS Configuration

Create DNS records pointing to your actual backend services:

```
gptr.bolabaden.org → CNAME → gptr.micklethefickle.bolabaden.org
```

### 2. Cloudflare Page Rules

Create Page Rules to route to the load balancer when DNS fails:

#### Rule 1: DNS Failure Fallback**

- URL: `gptr.bolabaden.org/*`
- Settings:
  - **Route to Worker**: `flowbalance.boden-crouch.workers.dev`
  - **Condition**: When DNS resolution fails

#### Rule 2: Service Failure Fallback**

- URL: `gptr.bolabaden.org/*`
- Settings:
  - **Route to Worker**: `flowbalance.boden-crouch.workers.dev`
  - **Condition**: When origin returns 5xx errors

### 3. Environment Variables

The worker is configured with these DNS-first settings:

```json
{
  "DNS_FIRST": "true",
  "DNS_FIRST_TIMEOUT_MS": "5000",
  "DNS_FIRST_FAILURE_STATUS_CODES": "500,502,503,504,520,521,522,523,524,525,526,527",
  "DNS_FIRST_MAX_RESPONSE_TIME_MS": "10000",
  "DNS_FIRST_HEALTH_CHECK_ENABLED": "true"
}
```

### 4. Load Balancer Configuration

The load balancer is configured with regex-based backend expansion:

```json
{
  "DEFAULT_BACKENDS": "{\"services\":[{\"hostname\":\"(.+).bolabaden.org\",\"backends\":[\"https://$1.micklethefickle.bolabaden.org\",\"https://$1.vractormania.bolabaden.org\",\"https://$1.beatapostapita.bolabaden.org\",\"https://$1-koyeb.bolabaden.org\",\"https://$1-render.bolabaden.org\",\"https://$1-railway.bolabaden.org\",\"https://$1-flyio.bolabaden.org\",\"https://$1-vercel.bolabaden.org\"]}]}"
}
```

## Expected Behavior

### Normal Operation

```
Request → DNS → Backend Service → Response
```

### DNS Failure

```
Request → DNS (fails) → Load Balancer Worker → Backend Pool → Response
```

### Service Failure

```
Request → DNS → Backend Service (5xx error) → Load Balancer Worker → Backend Pool → Response
```

## Testing

### Test DNS Success

```bash
curl -I https://gptr.bolabaden.org
# Should go directly to gptr.micklethefickle.bolabaden.org
```

### Test DNS Failure

```bash
curl -I https://nonexistent.bolabaden.org
# Should fall back to load balancer worker
```

### Test Service Failure

```bash
# When backend returns 5xx errors, should fall back to load balancer
curl -I https://gptr.bolabaden.org
```

## Monitoring

The worker adds these headers to indicate fallback usage:

- `X-DNS-First-Fallback: true` - Indicates this was a fallback request
- `X-Fallback-Reason: DNS resolution failed` - Reason for fallback
- `X-Backend-Used: backend-1` - Which backend was used

## Troubleshooting

### Worker Always Responds

- Check DNS records are pointing to actual backends
- Verify Page Rules are configured correctly
- Ensure backend services are healthy

### No Fallback on DNS Failure

- Verify Page Rules are active
- Check worker deployment status
- Review Cloudflare logs for routing decisions

### Performance Issues

- Adjust `DNS_FIRST_TIMEOUT_MS` for faster fallback
- Modify `DNS_FIRST_MAX_RESPONSE_TIME_MS` for different thresholds
- Review backend health check settings
