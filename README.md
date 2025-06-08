# Cloudflare Load Balancer Worker with OAuth Authentication

A sophisticated load balancer built on Cloudflare Workers that features OAuth authentication (GitHub/Google), a modern web interface, and dynamic backend configuration. Each service is managed by a separate Durable Object instance for high availability and performance.

## ✨ Features

### 🔐 Authentication

- **OAuth Integration**: Sign in with GitHub or Google
- **JWT Sessions**: Secure, stateless authentication
- **Basic Auth Fallback**: Backward compatibility for API access
- **Authorized Users**: Configurable email whitelist

### 🌐 Web Interface

- **Modern UI**: Beautiful, responsive design
- **Real-time Monitoring**: Live backend health status
- **Configuration Management**: Add/edit services through the web
- **Metrics Dashboard**: Request statistics and success rates

### ⚖️ Load Balancing

- **Multiple Services**: Support for multiple hostnames
- **Session Affinity**: IP hash, cookie-based, or none
- **Health Checks**: Active and passive monitoring
- **Failover**: Automatic backend switching
- **Weighted Round Robin**: Configurable backend weights

### 🔧 API

- **RESTful API**: Complete configuration management
- **Real-time Updates**: Changes take effect immediately
- **Metrics Export**: JSON and HTML formats
- **Bearer Token Auth**: Secure API access

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <your-repo>
cd cloudflare-failover-test
npm install
```

### 2. Configure OAuth Applications

#### GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Set Authorization callback URL to: `https://your-worker.your-subdomain.workers.dev/auth/github/callback`
4. Note the Client ID and Client Secret

#### Google OAuth App  

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new OAuth 2.0 Client ID
3. Set Authorized redirect URI to: `https://your-worker.your-subdomain.workers.dev/auth/google/callback`
4. Note the Client ID and Client Secret

### 3. Update Configuration

Edit `wrangler.toml` and update the environment variables:

```toml
[vars]
# OAuth Configuration
JWT_SECRET = "your-super-secret-jwt-key-change-this-in-production"
GITHUB_CLIENT_ID = "your-github-oauth-app-client-id"
GITHUB_CLIENT_SECRET = "your-github-oauth-app-client-secret"
GOOGLE_CLIENT_ID = "your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET = "your-google-oauth-client-secret"
AUTHORIZED_USERS = "your-email@example.com,another-user@example.com"

# API Configuration
API_SECRET = "your-api-secret-key"
WEB_AUTH_USERNAME = "admin"
WEB_AUTH_PASSWORD = "admin123"

# Load Balancer Configuration
DEFAULT_BACKENDS = "example.com|https://backend1.com|https://backend2.com"
ENABLE_WEB_INTERFACE = "true"
```

### 4. Deploy

```bash
npm run deploy
```

### 5. Access the Web Interface

Navigate to `https://your-worker.your-subdomain.workers.dev` and sign in with GitHub or Google!

## 🖥️ Web Interface

### Login Page

- OAuth buttons for GitHub and Google
- Basic auth fallback
- Modern, responsive design
- Clear error messaging

### Dashboard

- Service management interface
- Real-time health monitoring
- Add new services
- View metrics and statistics
- Global configuration overview
- API documentation

### Features

- **Service Management**: Add, configure, and monitor services
- **Backend Control**: Enable/disable individual backends
- **Health Checks**: Manual and automatic health verification
- **Metrics**: Request counts, success rates, response times
- **Configuration**: Session affinity, health check settings

## 🔌 API Reference

### Authentication

All API calls require authentication:

```bash
# OAuth (via web interface)
Cookie: auth_token=<jwt-token>

# Basic Auth (legacy)
Authorization: Basic <base64-encoded-credentials>

# Bearer Token (API)
Authorization: Bearer <api-secret>
```

### Service Configuration

```bash
# Configure a service
POST /admin/services/{hostname}/config
Content-Type: application/json

{
  "backends": [
    {
      "id": "backend1",
      "url": "https://backend1.example.com",
      "weight": 1,
      "healthy": true
    }
  ],
  "sessionAffinity": {
    "type": "ip",
    "enabled": true
  },
  "activeHealthChecks": {
    "enabled": true,
    "path": "/health",
    "intervalMs": 30000
  }
}
```

### Get Service Metrics

```bash
# JSON format
GET /admin/services/{hostname}/metrics

# HTML dashboard
GET /admin/services/{hostname}/metrics/dashboard
```

### Backend Management

```bash
# Enable/disable backend
POST /admin/services/{hostname}/backends/{backendId}/enable
POST /admin/services/{hostname}/backends/{backendId}/disable

# Manual health check
POST /admin/services/{hostname}/health-check
```

## 🛠️ Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `JWT_SECRET` | Secret key for JWT signing | Yes |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | Yes |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Yes |
| `AUTHORIZED_USERS` | Comma-separated list of authorized emails | Yes |
| `API_SECRET` | Bearer token for API access | Yes |
| `WEB_AUTH_USERNAME` | Basic auth username (fallback) | No |
| `WEB_AUTH_PASSWORD` | Basic auth password (fallback) | No |
| `DEFAULT_BACKENDS` | Default backend configuration | No |
| `ENABLE_WEB_INTERFACE` | Enable web interface (true/false) | No |

### Service Configuration Schema

```typescript
interface ServiceConfig {
  backends: Backend[];
  sessionAffinity: {
    type: 'none' | 'ip' | 'cookie';
    enabled: boolean;
    cookieName?: string;
    cookieTTLSeconds?: number;
  };
  activeHealthChecks: {
    enabled: boolean;
    path: string;
    intervalMs: number;
    timeoutMs: number;
    expectedStatusCode?: number;
  };
  passiveHealthChecks: {
    maxFailures: number;
    failureTimeoutMs: number;
    retryableStatusCodes: number[];
  };
  retryPolicy: {
    maxRetries: number;
  };
}
```

## 🔒 Security

### OAuth Flow

1. User clicks OAuth provider button
2. Redirected to provider for authorization
3. Provider redirects back with authorization code
4. Worker exchanges code for user information
5. User email checked against authorized list
6. JWT token created and set as secure cookie

### JWT Tokens

- 24-hour expiration
- HttpOnly, Secure, SameSite=Strict cookies
- Include user information and expiration time
- Signed with JWT_SECRET

### Authorization Levels

1. **OAuth Users**: Full web interface access (if email authorized)
2. **Basic Auth**: Legacy web interface access
3. **Bearer Token**: Full API access
4. **No Auth**: Public load balancing (backend services)

## 📊 Monitoring

### Built-in Metrics

- Total requests per service
- Success/failure rates
- Backend-specific statistics
- Response times
- Health check results

### Web Dashboard

- Real-time health status
- Service overview cards
- Backend management interface
- Historical metrics (coming soon)

## 🚦 Load Balancing

### Algorithms

- **Round Robin**: Default algorithm
- **Weighted Round Robin**: Based on backend weights
- **Session Affinity**: Sticky sessions via IP or cookie

### Health Checks

- **Active**: Periodic health endpoint checks
- **Passive**: Based on request success/failure
- **Configurable**: Custom paths, intervals, timeouts

### Failover

- Automatic backend disabling on consecutive failures
- Configurable failure thresholds
- Automatic re-enabling after recovery period

## 🛠️ Development

### Local Development

```bash
# Start development server
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Project Structure

```
src/
├── index.ts           # Main worker entry point
├── auth.ts           # OAuth and JWT authentication
├── frontend.ts       # Modern web interface
├── web-interface.ts  # Legacy web interface
├── durable-object.ts # Load balancer logic
├── config.ts         # Configuration management
├── types.ts          # TypeScript types
└── env.d.ts          # Environment type definitions
```

## 📋 TODO

- [ ] Historical metrics storage
- [ ] Advanced routing rules
- [ ] Rate limiting
- [ ] SSL certificate management
- [ ] Multi-region support
- [ ] Webhooks for health status changes
- [ ] API key management
- [ ] Audit logging

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- Check the API documentation in the web interface
- Review the configuration examples
- Open an issue for bug reports or feature requests

---

**Note**: Remember to keep your OAuth secrets and JWT secret secure. Never commit them to version control. Use Cloudflare Workers secrets or environment variables for production deployments.
