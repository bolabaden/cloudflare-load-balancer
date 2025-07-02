import { LoadBalancerEngine } from '../load-balancer-engine';
import { LoadBalancerServiceConfig, Backend, OriginPool } from '../types';

export class ControlPanelRenderer {
  constructor(
    private engine: LoadBalancerEngine,
    private config: LoadBalancerServiceConfig
  ) {}

  async renderControlPanel(): Promise<Response> {
    // Serve the static HTML template
    const template = this.getStaticTemplate();
    return new Response(template, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  }

  private getStaticTemplate(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Balancer Control Panel</title>
    <link rel="stylesheet" href="/css/dashboard.css">
</head>
<body>
    <nav class="navbar">
        <div class="nav-brand">
            <h1>Load Balancer Control Panel</h1>
        </div>
        <div class="nav-links">
            <a href="/dashboard" class="nav-link">Dashboard</a>
            <a href="/control-panel" class="nav-link active">Control Panel</a>
            <a href="/api-docs" class="nav-link">API Docs</a>
        </div>
    </nav>
    <main class="main-content">
        <div class="control-panel-header">
            <h2>Load Balancer Configuration</h2>
            <div class="control-actions">
                <button onclick="triggerHealthCheck()" class="btn btn-secondary">Run Health Check</button>
                <button onclick="exportConfig()" class="btn btn-secondary">Export Config</button>
                <button onclick="importConfig()" class="btn btn-secondary">Import Config</button>
                <button onclick="resetMetrics()" class="btn btn-danger">Reset Metrics</button>
            </div>
        </div>
        <div class="config-sections">
            <div class="config-section">
                <div class="section-header">
                    <h3>Service Configuration</h3>
                </div>
                <form id="service-config-form" class="config-form">
                    <div class="form-group">
                        <label for="service-name">Service Name</label>
                        <input type="text" id="service-name" name="name" required>
                    </div>
                    <div class="form-group">
                        <label for="algorithm">Load Balancing Algorithm</label>
                        <select id="algorithm" name="algorithm" title="Select load balancing algorithm">
                            <option value="round-robin">Round Robin</option>
                            <option value="weighted">Weighted Round Robin</option>
                            <option value="least-connections">Least Connections</option>
                        </select>
                    </div>
                    <div class="form-section">
                        <h4>Health Check Configuration</h4>
                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="health-check-enabled">
                                Enable Health Checks
                            </label>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="health-check-interval">Interval (seconds)</label>
                                <input type="number" id="health-check-interval" min="10" value="30">
                            </div>
                            <div class="form-group">
                                <label for="health-check-timeout">Timeout (seconds)</label>
                                <input type="number" id="health-check-timeout" min="1" value="5">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="health-check-path">Health Check Path</label>
                            <input type="text" id="health-check-path" placeholder="/health" value="/health">
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">Save Configuration</button>
                    </div>
                </form>
            </div>
            <div class="config-section">
                <div class="section-header">
                    <h3>Backend Pools</h3>
                </div>
                <div id="pools-container" class="pools-container">
                    <!-- Pool configurations will be populated by JavaScript -->
                </div>
            </div>
        </div>
        <div class="status-section">
            <div class="section-header">
                <h3>Current Status</h3>
            </div>
            <div class="status-grid">
                <div class="status-card">
                    <div class="status-label">Service Status</div>
                    <div class="status-value" id="service-status">Running</div>
                </div>
                <div class="status-card">
                    <div class="status-label">Total Backends</div>
                    <div class="status-value" id="total-backends">0</div>
                </div>
                <div class="status-card">
                    <div class="status-label">Healthy Backends</div>
                    <div class="status-value" id="healthy-backends">0</div>
                </div>
                <div class="status-card">
                    <div class="status-label">Last Health Check</div>
                    <div class="status-value" id="last-health-check">Never</div>
                </div>
            </div>
        </div>
    </main>
    <script src="/js/control-panel.js"></script>
</body>
</html>`;
  }

  private generateControlPanelHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Balancer Control Panel</title>
    <link rel="stylesheet" href="/css/dashboard.css">
    <style>
      .control-panel {
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
      }
      .section {
        background: white;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      .section h2 {
        margin-bottom: 15px;
        color: #2d3748;
      }
      .form-group {
        margin-bottom: 15px;
      }
      .form-group label {
        display: block;
        margin-bottom: 5px;
        font-weight: 500;
        color: #4a5568;
      }
      .form-group input, .form-group select, .form-group textarea {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        font-size: 14px;
      }
      .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
        outline: none;
        border-color: #4299e1;
        box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.1);
      }
      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        text-decoration: none;
        display: inline-block;
        transition: all 0.2s;
      }
      .btn-primary {
        background: #4299e1;
        color: white;
      }
      .btn-primary:hover {
        background: #3182ce;
      }
      .btn-secondary {
        background: #e2e8f0;
        color: #4a5568;
      }
      .btn-secondary:hover {
        background: #cbd5e0;
      }
      .btn-danger {
        background: #f56565;
        color: white;
      }
      .btn-danger:hover {
        background: #e53e3e;
      }
      .btn-success {
        background: #48bb78;
        color: white;
      }
      .btn-success:hover {
        background: #38a169;
      }
      .backend-list {
        margin-top: 15px;
      }
      .backend-item {
        display: flex;
        align-items: center;
        padding: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        margin-bottom: 10px;
        background: #f7fafc;
      }
      .backend-item.healthy {
        border-left: 4px solid #48bb78;
      }
      .backend-item.unhealthy {
        border-left: 4px solid #f56565;
      }
      .backend-info {
        flex: 1;
      }
      .backend-url {
        font-weight: 500;
        color: #2d3748;
      }
      .backend-details {
        font-size: 12px;
        color: #718096;
        margin-top: 2px;
      }
      .backend-actions {
        display: flex;
        gap: 8px;
      }
      .pool-section {
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 15px;
        margin-bottom: 15px;
      }
      .pool-header {
        display: flex;
        justify-content: between;
        align-items: center;
        margin-bottom: 10px;
      }
      .pool-name {
        font-weight: 500;
        color: #2d3748;
      }
      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
        margin-right: 8px;
      }
      .status-healthy { background: #48bb78; }
      .status-unhealthy { background: #f56565; }
      .config-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
      }
      @media (max-width: 768px) {
        .config-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
</head>
<body>
    <div class="dashboard">
        <header>
            <h1>Load Balancer Control Panel</h1>
            <nav>
                <a href="/">Dashboard</a>
                <a href="/docs">API Docs</a>
                <a href="/admin">Control Panel</a>
            </nav>
        </header>
        
        <div class="control-panel">
            <!-- Service Configuration -->
            <div class="section">
                <h2>Service Configuration</h2>
                <form id="service-config-form">
                    <div class="config-grid">
                        <div class="form-group">
                            <label for="service-name">Service Name</label>
                                                         <input type="text" id="service-name" name="name" value="${this.config.serviceId || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="algorithm">Load Balancing Algorithm</label>
                            <select id="algorithm" name="algorithm">
                                                                 <option value="round-robin" ${this.config.load_balancer?.steering_policy === 'off' ? 'selected' : ''}>Round Robin</option>
                                 <option value="weighted" ${this.config.load_balancer?.steering_policy === 'random' ? 'selected' : ''}>Weighted Round Robin</option>
                                 <option value="least-connections" ${this.config.load_balancer?.steering_policy === 'least_connections' ? 'selected' : ''}>Least Connections</option>
                            </select>
                        </div>
                    </div>
                    
                    <h3>Health Check Configuration</h3>
                    <div class="config-grid">
                        <div class="form-group">
                            <label>
                                                                 <input type="checkbox" id="health-check-enabled" ${this.config.activeHealthChecks?.enabled ? 'checked' : ''}>  
                                Enable Health Checks
                            </label>
                        </div>
                        <div class="form-group">
                            <label for="health-check-interval">Check Interval (seconds)</label>
                                                         <input type="number" id="health-check-interval" value="${this.config.activeHealthChecks?.interval || 30}" min="10">
                        </div>
                        <div class="form-group">
                            <label for="health-check-timeout">Timeout (seconds)</label>
                                                         <input type="number" id="health-check-timeout" value="${this.config.activeHealthChecks?.timeout || 5}" min="1">
                        </div>
                        <div class="form-group">
                            <label for="health-check-path">Health Check Path</label>
                                                         <input type="text" id="health-check-path" value="${this.config.activeHealthChecks?.path || '/health'}" placeholder="/health">
                        </div>
                    </div>
                    
                    <button type="submit" class="btn btn-primary">Update Configuration</button>
                </form>
            </div>
            
            <!-- Backend Pools Management -->
            <div class="section">
                <h2>Backend Pools</h2>
                <div id="pools-container">
                    ${this.renderPools()}
                </div>
                <button type="button" class="btn btn-secondary" onclick="addNewPool()">Add New Pool</button>
            </div>
            
            <!-- Actions -->
            <div class="section">
                <h2>Actions</h2>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button type="button" class="btn btn-success" onclick="triggerHealthCheck()">Run Health Check</button>
                    <button type="button" class="btn btn-secondary" onclick="exportConfig()">Export Configuration</button>
                    <button type="button" class="btn btn-secondary" onclick="importConfig()">Import Configuration</button>
                    <button type="button" class="btn btn-danger" onclick="resetMetrics()">Reset Metrics</button>
                </div>
            </div>
        </div>
    </div>
    
    <script src="/js/control-panel.js"></script>
</body>
</html>`;
  }

  private renderPools(): string {
    return this.config.pools.map((pool, poolIndex) => `
      <div class="pool-section" data-pool-index="${poolIndex}">
        <div class="pool-header">
          <div class="pool-name">Pool: ${pool.name}</div>
          <button type="button" class="btn btn-danger btn-sm" onclick="removePool(${poolIndex})">Remove Pool</button>
        </div>
        
        <div class="form-group">
          <label>Pool Name</label>
          <input type="text" value="${pool.name}" onchange="updatePoolName(${poolIndex}, this.value)">
        </div>
        
        <div class="backend-list">
          <h4>Backends</h4>
          ${this.renderBackends(pool.backends, poolIndex)}
          <button type="button" class="btn btn-secondary btn-sm" onclick="addBackend(${poolIndex})">Add Backend</button>
        </div>
      </div>
    `).join('');
  }

  private renderBackends(backends: Backend[], poolIndex: number): string {
    return backends.map((backend, backendIndex) => `
      <div class="backend-item ${backend.healthy !== false ? 'healthy' : 'unhealthy'}" data-backend-index="${backendIndex}">
        <div class="status-indicator ${backend.healthy !== false ? 'status-healthy' : 'status-unhealthy'}"></div>
        <div class="backend-info">
          <div class="backend-url">${backend.url}</div>
          <div class="backend-details">
            Weight: ${backend.weight || 1} | 
            Status: ${backend.healthy !== false ? 'Healthy' : 'Unhealthy'} |
                         Last Check: ${backend.lastSuccessTimestamp ? new Date(backend.lastSuccessTimestamp).toLocaleString() : 'Never'}
          </div>
        </div>
        <div class="backend-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="editBackend(${poolIndex}, ${backendIndex})">Edit</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="removeBackend(${poolIndex}, ${backendIndex})">Remove</button>
        </div>
      </div>
    `).join('');
  }
} 