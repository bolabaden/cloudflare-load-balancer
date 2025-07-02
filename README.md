# FlowBalance ⚖️

**Dead-simple load balancing for Cloudflare Workers**

Deploy reliable load balancing in minutes. No complex configuration needed.

```bash
# 1. Clone and setup
git clone <your-repo> flowbalance
cd flowbalance
npm install

# 2. Set a default backend (optional)
# This example sets two backend servers behind your hostname
export DEFAULT_BACKENDS='{"hostname": "your-public-facing-url", "backends": ["https://server1.com", "https://server2.com"]}'

# 3. One command deploy
npm run deploy

# 4. Point a DNS A/AAAA record from  `your-public-facing-url` to this cloudflare loadbalancer worker.
```

That's it! 🎉

Achieve industry-standard failover and fallback routing and integrate with your infrastructure seamlessly.

## Quick Start (2 minutes)

### 1. Set Your Backends

Edit your `wrangler.jsonc` and add your backends:

```json
{
  "vars": {
    "DEFAULT_BACKENDS": "{\"hostname\": \"your-domain.com\", \"backends\": [\"https://server1.com\", \"https://server2.com\"]}"
  }
}
```

### 2. Deploy

```bash
npm run deploy
```

### 3. Done

Your load balancer is live! It automatically:

- ✅ Health checks your backends
- ✅ Fails over when servers go down
- ✅ Distributes traffic evenly
- ✅ Handles connection errors gracefully

## What FlowBalance Does

- **Smart Health Checks**: Automatically finds `/health`, `/healthz`, `/status` endpoints
- **Zero-Downtime Failover**: Instant switchover when backends fail
- **Circuit Breakers**: Stops sending traffic to broken servers
- **Round Robin**: Even traffic distribution by default
- **Connection Error Handling**: Retries and failover for network issues

## Examples

### Single Service

```json
{
  "hostname": "api.myapp.com",
  "backends": [
    "https://api-server-1.myapp.com",
    "https://api-server-2.myapp.com"
  ]
}
```

### Multiple Services

```json
{
  "services": [
    {
      "hostname": "api.myapp.com", 
      "backends": ["https://api1.com", "https://api2.com"]
    },
    {
      "hostname": "files.myapp.com",
      "backends": ["https://files1.com", "https://files2.com"]
    }
  ]
}
```

## Configuration

FlowBalance works out-of-the-box with smart defaults. These settings handle 80%+ of use cases:

| Setting | Default | What it does |
|---------|---------|--------------|
| Health checks | Every 60s | Keeps bad servers out of rotation |
| Failover | Instant | Switches to healthy servers immediately |
| Retries | 1 retry | Tries failed requests once more |
| Circuit breaker | 3 failures | Stops traffic after 3 consecutive fails |
| Recovery | 60 seconds | How long to wait before trying failed servers |

## Web Dashboard

Visit `https://your-worker.workers.dev/__lb_admin__` to:

- 📊 See backend health status
- ⚙️ Adjust settings through the UI
- 📈 View traffic and error metrics
- 🔍 Browse request logs

Default login: Use GitHub or Google OAuth

## Troubleshooting

### "All backends are down"

1. Check your backend URLs are reachable
2. Verify health check endpoints exist (`/health`, `/healthz`, etc.)
3. Look at the admin dashboard for specific errors

### High response times

1. Check if backends are overloaded
2. Consider adding more backend servers
3. Verify network connectivity between Cloudflare and your servers

### 523 Connection errors

These are automatically handled! FlowBalance:

- Immediately fails over to healthy backends
- Opens circuit breakers for failing servers  
- Retries with exponential backoff

## Advanced Features

<details>
<summary>🔧 Custom Configuration (Click to expand)</summary>

### Advanced Health Checks

```json
{
  "activeHealthChecks": {
    "enabled": true,
    "path": "/custom-health",
    "interval": 30,
    "timeout": 10,
    "consecutive_up": 3,
    "consecutive_down": 2
  }
}
```

### Geographic Routing

```json
{
  "pools": [{
    "id": "us-pool",
    "geo_steering": {
      "regions": ["US", "CA"],
      "fallback_pool": "global-pool"
    }
  }]
}
```

### Session Affinity

```json
{
  "load_balancer": {
    "session_affinity": {
      "type": "cookie",
      "cookie_name": "lb_session"
    }
  }
}
```

### Weighted Backend Distribution

```json
{
  "backends": [
    {"url": "https://big-server.com", "weight": 3},
    {"url": "https://small-server.com", "weight": 1}
  ]
}
```

</details>

<details>
<summary>🚀 Performance Tuning (Click to expand)</summary>

### Aggressive Health Checks

```json
{
  "activeHealthChecks": {
    "interval": 10,
    "timeout": 3,
    "consecutive_down": 1
  }
}
```

### Circuit Breaker Tuning

```json
{
  "passiveHealthChecks": {
    "circuit_breaker": {
      "failure_threshold": 1,
      "recovery_timeout_ms": 30000,
      "error_rate_threshold": 25
    }
  }
}
```

### Connection Optimizations

```json
{
  "connection_error_handling": {
    "immediate_failover": true,
    "max_connection_retries": 0,
    "connection_timeout_ms": 5000
  }
}
```

</details>

<details>
<summary>🏢 Enterprise Features (Click to expand)</summary>

### Advanced Monitoring

- Health scoring algorithms
- Performance analytics  
- Alert integrations
- Custom middleware support

### Security Features

- OAuth authentication (GitHub, Google)
- API key management
- Access control lists
- Request rate limiting

### Integration APIs

- REST API for configuration
- Webhook notifications
- Metrics export
- Log streaming

### High Availability

- Multi-region deployments
- DNS failover support
- Edge location optimization
- Automated recovery procedures

See [Advanced Configuration Guide](./docs/advanced.md) for complete documentation.

</details>

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b my-feature`
3. Run tests: `npm test`
4. Submit a pull request

## Support

- 📖 [Documentation](./docs/)
- 🐛 [Issues](https://github.com/your-repo/flowbalance/issues)
- 💬 [Discussions](https://github.com/your-repo/flowbalance/discussions)

## License

MIT License - see [LICENSE](LICENSE) file.

---

**Made with ❤️ for developers who want load balancing, failover, and high availability that *just works*.**
