import { LoadBalancerEngine } from '../load-balancer-engine';
import { LoadBalancerServiceConfig, Backend } from '../types';

export interface DashboardStats {
  totalRequests: number;
  activeBackends: number;
  averageResponseTime: number;
  uptime: number;
  healthyBackends: number;
  totalBackends: number;
  errorRate: number;
  requestsPerSecond: number;
}

export class DashboardRenderer {
  constructor(
    private engine: LoadBalancerEngine,
    private config: LoadBalancerServiceConfig
  ) {}

  async getStats(): Promise<DashboardStats> {
    const metrics = this.engine.getMetrics();
    const allBackends = this.config.pools.flatMap(pool => pool.backends);
    const healthyBackends = allBackends.filter((b: Backend) => b.healthy !== false).length;
    
    // Calculate aggregate metrics from backend metrics
    const totalResponseTime = Object.values(metrics.backendMetrics).reduce(
      (sum, backend) => sum + (backend.totalResponseTimeMs || 0), 0
    );
    const totalRequests = metrics.totalRequests || 0;
    const averageResponseTime = totalRequests > 0 ? totalResponseTime / totalRequests : 0;
    const errorRate = totalRequests > 0 ? 
      (metrics.totalFailedRequests || 0) / totalRequests : 0;
    
    return {
      totalRequests,
      activeBackends: healthyBackends,
      averageResponseTime,
      uptime: Date.now() - Date.now(), // Placeholder - no uptime tracking in current metrics
      healthyBackends,
      totalBackends: allBackends.length,
      errorRate,
      requestsPerSecond: 0, // Placeholder - would need time-based calculation
    };
  }

  async renderDashboard(): Promise<Response> {
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
    <title>Load Balancer Dashboard</title>
    <link rel="stylesheet" href="/css/dashboard.css">
</head>
<body>
    <nav class="navbar">
        <div class="nav-brand">
            <h1>Load Balancer Dashboard</h1>
        </div>
        <div class="nav-links">
            <a href="/dashboard" class="nav-link active">Dashboard</a>
            <a href="/control-panel" class="nav-link">Control Panel</a>
            <a href="/api-docs" class="nav-link">API Docs</a>
        </div>
    </nav>
    <main class="main-content">
        <div class="dashboard-header">
            <h2>System Overview</h2>
            <div class="dashboard-actions">
                <button id="refresh-btn" class="btn btn-primary">Refresh</button>
                <label class="toggle-switch">
                    <input type="checkbox" id="auto-refresh" checked>
                    <span class="slider">Auto-refresh</span>
                </label>
            </div>
        </div>
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-header">
                    <h3>Total Requests</h3>
                    <div class="metric-trend" id="requests-trend"></div>
                </div>
                <div class="metric-value" id="total-requests">0</div>
                <div class="metric-subtitle">Last 24 hours</div>
            </div>
            <div class="metric-card">
                <div class="metric-header">
                    <h3>Success Rate</h3>
                    <div class="metric-trend" id="success-trend"></div>
                </div>
                <div class="metric-value" id="success-rate">0%</div>
                <div class="metric-subtitle">2xx responses</div>
            </div>
            <div class="metric-card">
                <div class="metric-header">
                    <h3>Average Response Time</h3>
                    <div class="metric-trend" id="response-time-trend"></div>
                </div>
                <div class="metric-value" id="avg-response-time">0ms</div>
                <div class="metric-subtitle">Last hour</div>
            </div>
            <div class="metric-card">
                <div class="metric-header">
                    <h3>Active Backends</h3>
                    <div class="metric-trend" id="backends-trend"></div>
                </div>
                <div class="metric-value" id="active-backends">0/0</div>
                <div class="metric-subtitle">Healthy/Total</div>
            </div>
        </div>
        <div class="dashboard-grid">
            <div class="dashboard-section">
                <div class="section-header">
                    <h3>Backend Status</h3>
                </div>
                <div id="backend-status-list" class="backend-status-list">
                    <!-- Backend status items will be populated by JavaScript -->
                </div>
            </div>
            <div class="dashboard-section full-width">
                <div class="section-header">
                    <h3>Recent Activity</h3>
                    <div class="activity-filters">
                        <button class="filter-btn active" data-filter="all">All</button>
                        <button class="filter-btn" data-filter="errors">Errors</button>
                        <button class="filter-btn" data-filter="health">Health Checks</button>
                    </div>
                </div>
                <div id="activity-log" class="activity-log">
                    <!-- Activity log items will be populated by JavaScript -->
                </div>
            </div>
        </div>
    </main>
    <script src="/js/dashboard.js"></script>
</body>
</html>`;
  }

  private generateDashboardHTML(stats: DashboardStats): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Balancer Dashboard</title>
    <link rel="stylesheet" href="/css/dashboard.css">
</head>
<body>
    <div class="dashboard">
        <header>
            <h1>Load Balancer Dashboard</h1>
            <nav>
                <a href="/">Dashboard</a>
                <a href="/docs">API Docs</a>
                <a href="/admin">Control Panel</a>
            </nav>
        </header>
        
        <main>
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Total Requests</h3>
                    <div class="stat-value">${stats.totalRequests.toLocaleString()}</div>
                </div>
                
                <div class="stat-card">
                    <h3>Active Backends</h3>
                    <div class="stat-value">${stats.activeBackends}/${stats.totalBackends}</div>
                </div>
                
                <div class="stat-card">
                    <h3>Average Response Time</h3>
                    <div class="stat-value">${stats.averageResponseTime.toFixed(2)}ms</div>
                </div>
                
                <div class="stat-card">
                    <h3>Error Rate</h3>
                    <div class="stat-value">${(stats.errorRate * 100).toFixed(2)}%</div>
                </div>
                
                <div class="stat-card">
                    <h3>Requests/Second</h3>
                    <div class="stat-value">${stats.requestsPerSecond.toFixed(2)}</div>
                </div>
                
                <div class="stat-card">
                    <h3>Uptime</h3>
                    <div class="stat-value">${this.formatUptime(stats.uptime)}</div>
                </div>
            </div>
            
            <div class="backends-section">
                <h2>Backend Status</h2>
                <div id="backends-list">
                    ${this.renderBackendsList()}
                </div>
            </div>
        </main>
    </div>
    
    <script src="/js/dashboard.js"></script>
</body>
</html>`;
  }

  private renderBackendsList(): string {
    const backends = this.config.pools.flatMap(pool => 
      pool.backends.map(backend => ({
        ...backend,
        pool: pool.name
      }))
    );

    return backends.map(backend => `
      <div class="backend-item ${backend.healthy !== false ? 'healthy' : 'unhealthy'}">
        <div class="backend-url">${backend.url}</div>
        <div class="backend-pool">Pool: ${backend.pool}</div>
        <div class="backend-status">${backend.healthy !== false ? 'Healthy' : 'Unhealthy'}</div>
        <div class="backend-weight">Weight: ${backend.weight || 1}</div>
      </div>
    `).join('');
  }

  private formatUptime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
} 