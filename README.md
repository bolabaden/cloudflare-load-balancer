# Cloudflare Load Balancer Worker

A minimal, high-performance load balancer built on Cloudflare Workers with Durable Objects for state management.

## Features

- **Simple Load Balancing**: Round-robin and weighted distribution across multiple backends
- **Retry Logic**: Configurable retry policies with exponential backoff
- **Metrics**: Request tracking and performance monitoring
- **API Management**: RESTful API for configuration and monitoring

## Architecture

- **Worker**: Main entry point handling routing and admin API
- **Durable Object**: Stateful load balancer instance per service hostname
- **TypeScript**: Full type safety and modern development experience

## Configuration

### Environment Variables

```bash
# Required
DEFAULT_BACKENDS=hostname1|url1,url2,url3,hostname2|url4,url5
API_SECRET=your-api-secret-key

# Optional
DEBUG=false
ENVIRONMENT=production
```

### Backend Configuration Format

```
hostname|backend1,backend2,backend3
```

Example:
```
yourapp.example.com|https://backend1.example.com,https://backend2.example.com
```

## API Endpoints

### Admin API (Worker Domain)

- `GET /admin/list` - List all configured services
- `GET /admin/{service}/config` - Get service configuration
- `GET /admin/{service}/backends` - Get backend status
- `GET /admin/{service}/metrics` - Get service metrics

## Development

```bash
# Install dependencies
npm install

# Development
npm run dev

# Build
npm run build

# Deploy
npm run deploy

# Type checking
npm run typecheck

# Linting
npm run lint
```

## Deployment

1. Configure your `wrangler.jsonc` with your domain routes
2. Set environment variables in Cloudflare dashboard
3. Deploy with `npm run deploy`

## License

MIT
