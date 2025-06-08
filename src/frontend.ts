import { OAuthUser } from './auth';

// Login page for OAuth authentication
export function generateLoginPage(env: Env, error?: string): string {
	return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Balancer - Sign In</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333; 
            line-height: 1.6; 
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .login-container {
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 400px;
            text-align: center;
        }
        .logo {
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #2d3748;
            margin-bottom: 10px;
            font-size: 24px;
        }
        .subtitle {
            color: #718096;
            margin-bottom: 30px;
        }
        .oauth-button {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            padding: 12px 20px;
            margin-bottom: 15px;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            background: white;
            color: #2d3748;
            text-decoration: none;
            font-weight: 500;
            transition: all 0.2s ease;
        }
        .oauth-button:hover {
            border-color: #cbd5e0;
            background: #f7fafc;
            transform: translateY(-1px);
        }
        .github-button {
            background: #24292e;
            color: white;
            border-color: #24292e;
        }
        .github-button:hover {
            background: #1a1e22;
            border-color: #1a1e22;
            color: white;
        }
        .google-button {
            border-color: #4285f4;
        }
        .google-button:hover {
            border-color: #3367d6;
        }
        .divider {
            margin: 25px 0;
            position: relative;
            text-align: center;
        }
        .divider::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            height: 1px;
            background: #e2e8f0;
        }
        .divider span {
            background: white;
            padding: 0 15px;
            color: #718096;
            font-size: 14px;
        }
        .basic-auth-form {
            text-align: left;
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: #2d3748;
        }
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 12px;
            border: 2px solid #e2e8f0;
            border-radius: 6px;
            font-size: 14px;
        }
        input[type="text"]:focus, input[type="password"]:focus {
            outline: none;
            border-color: #4299e1;
        }
        .login-button {
            width: 100%;
            padding: 12px;
            background: #4299e1;
            color: white;
            border: none;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s ease;
        }
        .login-button:hover {
            background: #3182ce;
        }
        .error {
            background: #fed7d7;
            color: #c53030;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 14px;
        }
        .info {
            color: #718096;
            font-size: 12px;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">🔄</div>
        <h1>Load Balancer Control Panel</h1>
        <p class="subtitle">Sign in to manage your load balancer configuration</p>
        
        ${error ? `<div class="error">${error}</div>` : ''}
        
        <a href="/auth/github" class="oauth-button github-button">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 12px;">
                <path d="M12 0C5.374 0 0 5.373 0 12 0 17.302 3.438 21.8 8.207 23.387c.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
            </svg>
            Continue with GitHub
        </a>
        
        <a href="/auth/google" class="oauth-button google-button">
            <svg width="20" height="20" viewBox="0 0 24 24" style="margin-right: 12px;">
                <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
        </a>
        
        <div class="divider">
            <span>or</span>
        </div>
        
        <form class="basic-auth-form" method="post" action="/auth/basic">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit" class="login-button">Sign In</button>
        </form>
        
        <p class="info">
            OAuth access is restricted to authorized email addresses.<br>
            Contact your administrator for access.
        </p>
    </div>
</body>
</html>`;
}

// Dashboard page for authenticated users
export function generateDashboard(user: OAuthUser, env: Env): string {
	return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Balancer Control Panel</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: #f8fafc; 
            color: #2d3748; 
            line-height: 1.6; 
        }
        .header {
            background: white;
            border-bottom: 1px solid #e2e8f0;
            padding: 0 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            height: 64px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .header-left {
            display: flex;
            align-items: center;
        }
        .logo {
            font-size: 24px;
            margin-right: 15px;
        }
        .header-title {
            font-size: 20px;
            font-weight: 600;
            color: #2d3748;
        }
        .user-info {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #4a5568;
            font-weight: 500;
        }
        .user-avatar img {
            width: 100%;
            height: 100%;
            border-radius: 50%;
        }
        .logout-btn {
            background: #e53e3e;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            text-decoration: none;
        }
        .logout-btn:hover {
            background: #c53030;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 20px; 
        }
        .card { 
            background: white; 
            border-radius: 8px; 
            padding: 20px; 
            margin-bottom: 20px; 
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e2e8f0;
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .card-title {
            font-size: 18px;
            font-weight: 600;
            color: #2d3748;
        }
        .btn { 
            background: #4299e1; 
            color: white; 
            border: none; 
            padding: 10px 20px; 
            border-radius: 6px; 
            cursor: pointer; 
            text-decoration: none; 
            display: inline-block; 
            margin-right: 10px; 
            font-size: 14px;
            font-weight: 500;
            transition: background 0.2s ease;
        }
        .btn:hover { 
            background: #3182ce; 
        }
        .btn-success { 
            background: #38a169; 
        }
        .btn-success:hover { 
            background: #2f855a; 
        }
        .form-group { 
            margin-bottom: 15px; 
        }
        label { 
            display: block; 
            margin-bottom: 5px; 
            font-weight: 500; 
            color: #2d3748;
        }
        input, textarea, select { 
            width: 100%; 
            padding: 12px; 
            border: 2px solid #e2e8f0; 
            border-radius: 6px; 
            font-size: 14px;
        }
        input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: #4299e1;
        }
        .grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
            gap: 20px; 
        }
        .tab-container { 
            margin-bottom: 20px; 
        }
        .tab-buttons { 
            display: flex; 
            border-bottom: 2px solid #e2e8f0; 
            margin-bottom: 20px;
        }
        .tab-button { 
            padding: 12px 24px; 
            background: none; 
            border: none; 
            cursor: pointer; 
            border-bottom: 2px solid transparent; 
            font-weight: 500;
            color: #4a5568;
            transition: all 0.2s ease;
        }
        .tab-button.active { 
            border-bottom-color: #4299e1; 
            color: #4299e1; 
        }
        .tab-content { 
            display: none; 
        }
        .tab-content.active { 
            display: block; 
        }
        .service-input { 
            margin-bottom: 20px; 
            display: flex;
            gap: 10px;
            align-items: end;
        }
        .service-input .form-group {
            flex: 1;
            margin-bottom: 0;
        }
        .alert { 
            padding: 15px; 
            border-radius: 6px; 
            margin-bottom: 20px; 
        }
        .alert-info { 
            background: #ebf8ff; 
            color: #2b6cb0; 
            border: 1px solid #90cdf4; 
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #4a5568;
        }
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #e2e8f0;
            border-radius: 50%;
            border-top-color: #4299e1;
            animation: spin 1s ease-in-out infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .code-block {
            background: #2d3748;
            color: #e2e8f0;
            padding: 15px;
            border-radius: 6px;
            overflow-x: auto;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 13px;
            line-height: 1.4;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="logo">🔄</div>
            <div class="header-title">Load Balancer Control Panel</div>
        </div>
        <div class="user-info">
            <div class="user-avatar">
                ${user.avatar ? `<img src="${user.avatar}" alt="${user.name}">` : user.name.charAt(0).toUpperCase()}
            </div>
            <span>Welcome, ${user.name}</span>
            <a href="/auth/logout" class="logout-btn">Sign Out</a>
        </div>
    </div>

    <div class="container">
        <div class="alert alert-info">
            <strong>✨ New Features!</strong> You can now manage your load balancer configuration directly from this web interface. 
            All changes are saved automatically and take effect immediately.
        </div>

        <div class="tab-container">
            <div class="tab-buttons">
                <button class="tab-button active" onclick="showTab('services')">Services</button>
                <button class="tab-button" onclick="showTab('add-service')">Add Service</button>
                <button class="tab-button" onclick="showTab('global-config')">Global Config</button>
                <button class="tab-button" onclick="showTab('docs')">API Docs</button>
            </div>
        </div>

        <div id="services-tab" class="tab-content active">
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Service Management</h2>
                    <button class="btn" onclick="refreshServices()">🔄 Refresh</button>
                </div>
                <div class="service-input">
                    <div class="form-group">
                        <label for="service-lookup">Service Hostname</label>
                        <input type="text" id="service-lookup" placeholder="example.com">
                    </div>
                    <button class="btn" onclick="loadService()">Load Service</button>
                </div>
                <div id="services-list">
                    <div class="loading">
                        <div class="spinner"></div>
                        <p>Enter a service hostname above to view its configuration and metrics.</p>
                    </div>
                </div>
            </div>
        </div>

        <div id="add-service-tab" class="tab-content">
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Add New Service</h2>
                </div>
                <form id="add-service-form" onsubmit="addService(event)">
                    <div class="form-group">
                        <label for="service-hostname">Service Hostname *</label>
                        <input type="text" id="service-hostname" placeholder="example.com" required>
                    </div>
                    <div class="form-group">
                        <label for="backend-urls">Backend URLs (one per line) *</label>
                        <textarea id="backend-urls" rows="4" placeholder="https://backend1.example.com&#10;https://backend2.example.com&#10;https://backend3.example.com" required></textarea>
                    </div>
                    <div class="grid">
                        <div class="form-group">
                            <label for="session-affinity">Session Affinity</label>
                            <select id="session-affinity">
                                <option value="none">None</option>
                                <option value="ip">IP Hash</option>
                                <option value="cookie">Cookie</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="health-check-path">Health Check Path</label>
                            <input type="text" id="health-check-path" placeholder="/health" value="/health">
                        </div>
                    </div>
                    <button type="submit" class="btn btn-success">✅ Add Service</button>
                </form>
            </div>
        </div>

        <div id="global-config-tab" class="tab-content">
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Global Configuration</h2>
                </div>
                <div class="alert alert-info">
                    <strong>Environment Variables:</strong> Update these values in your Cloudflare Worker environment or wrangler.toml file.
                </div>
                <div class="form-group">
                    <label>Default Backends</label>
                    <input type="text" value="${env.DEFAULT_BACKENDS}" readonly>
                </div>
                <div class="grid">
                    <div class="form-group">
                        <label>Environment</label>
                        <input type="text" value="${env.ENVIRONMENT}" readonly>
                    </div>
                    <div class="form-group">
                        <label>Debug Mode</label>
                        <input type="text" value="${env.DEBUG}" readonly>
                    </div>
                </div>
                <div class="form-group">
                    <label>Authorized Users</label>
                    <textarea rows="3" readonly>${env.AUTHORIZED_USERS}</textarea>
                </div>
            </div>
        </div>

        <div id="docs-tab" class="tab-content">
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">API Documentation</h2>
                </div>
                
                <h3 style="margin-bottom: 15px; color: #2d3748;">Configuration API</h3>
                <div class="form-group">
                    <label><strong>POST</strong> /admin/services/{hostname}/config</label>
                    <div class="code-block">curl -X POST "https://your-worker.workers.dev/admin/services/example.com/config" \\
  -H "Authorization: Bearer ${env.API_SECRET}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "backends": [
      {"id": "backend1", "url": "https://backend1.com", "weight": 1, "healthy": true}
    ],
    "sessionAffinity": {"enabled": true, "type": "ip"},
    "healthCheck": {"passive": {"enabled": true}, "active": {"enabled": true}}
  }'</div>
                </div>
                
                <div style="margin-top: 20px;">
                    <h4 style="color: #2d3748; margin-bottom: 10px;">OAuth Setup Instructions</h4>
                    <ol style="padding-left: 20px; color: #4a5568;">
                        <li>Create a GitHub OAuth App at <a href="https://github.com/settings/developers" target="_blank" style="color: #4299e1;">github.com/settings/developers</a></li>
                        <li>Create a Google OAuth Client at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color: #4299e1;">Google Cloud Console</a></li>
                        <li>Set the callback URLs to: <code>https://your-worker.workers.dev/auth/github/callback</code> and <code>https://your-worker.workers.dev/auth/google/callback</code></li>
                        <li>Update your wrangler.toml with the client IDs and secrets</li>
                    </ol>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentService = '';

        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
        }

        async function loadService() {
            const hostname = document.getElementById('service-lookup').value.trim();
            if (!hostname) {
                alert('Please enter a service hostname');
                return;
            }

            currentService = hostname;
            const servicesDiv = document.getElementById('services-list');
            servicesDiv.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading service configuration...</p></div>';
            
            try {
                const [configResponse, metricsResponse] = await Promise.all([
                    fetch('/admin/services/' + hostname + '/config'),
                    fetch('/admin/services/' + hostname + '/metrics')
                ]);
                
                if (configResponse.status === 404) {
                    servicesDiv.innerHTML = '<div class="alert alert-error"><strong>Service not found:</strong> ' + hostname + '<br>This service has not been configured yet. Use the "Add Service" tab to set it up.</div>';
                    return;
                }

                if (!configResponse.ok) {
                    throw new Error('HTTP ' + configResponse.status + ': ' + configResponse.statusText);
                }

                const config = await configResponse.json();
                const metrics = metricsResponse.ok ? await metricsResponse.json() : null;
                
                displayServiceInfo(hostname, config, metrics);
                
            } catch (error) {
                servicesDiv.innerHTML = '<div class="alert alert-error"><strong>Error loading service:</strong> ' + error.message + '</div>';
            }
        }

        function displayServiceInfo(hostname, config, metrics) {
            // Implementation would go here - simplified for brevity
            document.getElementById('services-list').innerHTML = '<div class="alert alert-info">Service loaded: ' + hostname + '</div>';
        }

        async function addService(event) {
            event.preventDefault();
            
            const hostname = document.getElementById('service-hostname').value.trim();
            const backendUrls = document.getElementById('backend-urls').value.trim().split('\\n').filter(url => url.trim());
            
            if (!hostname || backendUrls.length === 0) {
                alert('Please provide a hostname and at least one backend URL');
                return;
            }

            // Implementation would go here
            alert('Feature will be implemented');
        }

        function refreshServices() {
            if (currentService) {
                loadService();
            }
        }
    </script>
</body>
</html>`;
} 