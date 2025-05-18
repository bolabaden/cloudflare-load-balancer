# Cloudflare Failover Proxy

A Cloudflare Worker that provides automatic failover between multiple backend servers. It routes traffic to healthy backends and offers a real-time dashboard for monitoring the status of each backend.

## Features

- **Invisible Proxy**: The worker is completely transparent to both clients and backends.
- **Automatic Failover**: Automatically routes traffic to healthy backends.
- **Health Checks**: Performs regular health checks on all backends.
- **Real-time Dashboard**: Provides a dashboard for monitoring the status of backends.
- **Metrics Collection**: Tracks response times, success rates, and other metrics.

## Setup

1. Install dependencies:

    ```bash
    npm install
    ```

2. Configure your backends in `worker.js`:

    ```javascript
    const BACKENDS = [
      { ip: "xxx.xxx.xxx.xxx", name: "VPS1" },
      { ip: "xxx.xxx.xxx.xxx", name: "VPS2" },
      { ip: "xxx.xxx.xxx.xxx", name: "VPS3" },
    ];
    ```

3. Configure the `wrangler.toml` file with your routes:

    ```toml
    [env.production]
    routes = [
      { pattern = "example.com/*", zone_name = "example.com" },
      { pattern = "api.example.com/*", zone_name = "example.com" }
    ]
    ```

4. Run locally for development:

    ```bash
    npx wrangler dev
    ```

5. Deploy to Cloudflare:

    ```bash
    npx wrangler deploy
    ```

## GitHub Integration

This project is configured to automatically deploy to Cloudflare Workers when changes are pushed to the GitHub repository. The configuration settings are:

- **Deploy Command**: `npx wrangler deploy`
- **Version Command**: `npx wrangler versions upload` 
- **Root Directory**: `/`
- **Production Branch**: `main`
- **Non-Production Branches**: Enabled (will create preview deployments)

## Dashboard Access

The dashboard is automatically available on your worker's domain:

```
https://failover-proxy.your-account.workers.dev
```

## Customizing

### Health Check Endpoint

By default, the health check uses `https://httpbin.org/status/200`. You can customize this in the `testAllBackends` function in `worker.js`.

### Health Check Frequency

Health checks are configured to run every 5 minutes by default. You can change this in the `wrangler.toml` file by modifying the cron trigger:

```toml
[triggers]
crons = ["*/5 * * * *"]  # Run health checks every 5 minutes
```

### Dashboard Appearance

The dashboard UI is defined in the `serveDashboard` function in `worker.js`. Customize the HTML and CSS as needed.

## Advanced Configuration

### Using KV for Persistent Metrics

Uncomment the KV namespace configuration in `wrangler.toml` to use KV for persistent metrics storage:

```toml
[kv_namespaces]
[[kv_namespaces]]
binding = "METRICS"
id = "<YOUR_KV_NAMESPACE_ID>"
```

You'll need to create a KV namespace first:

```bash
npx wrangler kv:namespace create "METRICS"
```

## License

MIT
