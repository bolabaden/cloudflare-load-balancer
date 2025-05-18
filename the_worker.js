export default {
  // Keep track of metrics within the worker
  metrics: {
    requestCount: 0,
    statusCodes: {},
    methods: {},
    backendUsage: {},
    responseTimes: [],
    errors: [],
    backendStats: {
      '149.130.221.93': { requests: 0, successes: 0, failures: 0, avgResponseTime: 0 },
      '207.221.189.95': { requests: 0, successes: 0, failures: 0, avgResponseTime: 0 },
      '152.117.108.32': { requests: 0, successes: 0, failures: 0, avgResponseTime: 0 }
    },
    lastUpdated: new Date().toISOString()
  },

  async fetch(request, env, ctx) {
    // Parse the incoming URL
    const url = new URL(request.url);
    const hostname = url.hostname;
    const startTime = Date.now();

    // Check if the request is for the metrics page
    if (hostname === "bolabaden.boden-crouch.workers.dev") {
      return this.generateMetricsPage(env);
    }

    // Reverse Proxy Logic with metrics collection
    if (hostname.endsWith('.bolabaden.org')) {
      const ips = [
        '149.130.221.93',
        '207.221.189.95',
        '152.117.108.32'
      ];

      // Increment request count
      this.metrics.requestCount++;

      // Track HTTP method
      const method = request.method;
      this.metrics.methods[method] = (this.metrics.methods[method] || 0) + 1;

      // Try each backend IP
      for (const ip of ips) {
        try {
          // Increment backend request counter
          this.metrics.backendStats[ip].requests++;
          this.metrics.backendUsage[ip] = (this.metrics.backendUsage[ip] || 0) + 1;

          const proxyStartTime = Date.now();
          const proxyResponse = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            redirect: 'follow',
            cf: { resolveOverride: ip }
          });

          const responseTime = Date.now() - proxyStartTime;

          // Record response status
          const statusCode = proxyResponse.status;
          const statusGroup = Math.floor(statusCode / 100) + 'xx';
          this.metrics.statusCodes[statusGroup] = (this.metrics.statusCodes[statusGroup] || 0) + 1;

          // Record response time
          this.metrics.responseTimes.push(responseTime);

          // Keep response times array manageable (limit to last 1000)
          if (this.metrics.responseTimes.length > 1000) {
            this.metrics.responseTimes.shift();
          }

          // Update backend stats
          if (proxyResponse.ok) {
            this.metrics.backendStats[ip].successes++;

            // Calculate running average response time
            const oldAvg = this.metrics.backendStats[ip].avgResponseTime;
            const oldCount = this.metrics.backendStats[ip].successes;
            this.metrics.backendStats[ip].avgResponseTime =
              (oldAvg * (oldCount - 1) + responseTime) / oldCount;

            // Update timestamp
            this.metrics.lastUpdated = new Date().toISOString();

            // Store metrics to Cloudflare KV if available
            if (env.METRICS_STORE) {
              ctx.waitUntil(env.METRICS_STORE.put('proxyMetrics', JSON.stringify(this.metrics)));
            }

            return proxyResponse;
          }

          // Record error
          this.metrics.backendStats[ip].failures++;
          this.metrics.errors.push({
            timestamp: new Date().toISOString(),
            status: statusCode,
            path: url.pathname,
            backend: ip,
            error: `HTTP ${statusCode}`
          });

          // Keep errors array manageable (limit to last 100)
          if (this.metrics.errors.length > 100) {
            this.metrics.errors.shift();
          }

        } catch (err) {
          // Record error
          this.metrics.backendStats[ip].failures++;
          this.metrics.errors.push({
            timestamp: new Date().toISOString(),
            path: url.pathname,
            backend: ip,
            error: err.message || 'Connection error'
          });

          // Keep errors array manageable
          if (this.metrics.errors.length > 100) {
            this.metrics.errors.shift();
          }

          continue;
        }
      }

      // All backends failed
      const statusGroup = '5xx';
      this.metrics.statusCodes[statusGroup] = (this.metrics.statusCodes[statusGroup] || 0) + 1;

      // Update timestamp
      this.metrics.lastUpdated = new Date().toISOString();

      // Store metrics to Cloudflare KV if available
      if (env.METRICS_STORE) {
        ctx.waitUntil(env.METRICS_STORE.put('proxyMetrics', JSON.stringify(this.metrics)));
      }

      return new Response('Service Unavailable', { status: 503 });
    }

    return fetch(request);
  },

  async generateMetricsPage(env) {
    // Get metrics from storage if available
    let metrics = this.metrics;
    if (env.METRICS_STORE) {
      try {
        const storedMetrics = await env.METRICS_STORE.get('proxyMetrics', { type: 'json' });
        if (storedMetrics) {
          metrics = storedMetrics;
        }
      } catch (err) {
        // Use in-memory metrics if storage fails
      }
    }

    // Calculate derived metrics
    const totalRequests = metrics.requestCount || 0;
    const avgResponseTime = metrics.responseTimes.length > 0
      ? Math.round(metrics.responseTimes.reduce((sum, time) => sum + time, 0) / metrics.responseTimes.length)
      : 0;

    // Calculate success rate
    const successfulRequests = (metrics.statusCodes['2xx'] || 0) + (metrics.statusCodes['3xx'] || 0);
    const successRate = totalRequests > 0
      ? ((successfulRequests / totalRequests) * 100).toFixed(1)
      : '100.0';

    // Calculate active backends
    const activeBackends = Object.keys(metrics.backendStats)
      .filter(ip => metrics.backendStats[ip].successes > 0)
      .length;

    // Calculate response time distribution
    const responseTimeBuckets = {
      '0-50ms': 0,
      '51-100ms': 0,
      '101-200ms': 0,
      '201-500ms': 0,
      '501ms+': 0
    };

    metrics.responseTimes.forEach(time => {
      if (time <= 50) responseTimeBuckets['0-50ms']++;
      else if (time <= 100) responseTimeBuckets['51-100ms']++;
      else if (time <= 200) responseTimeBuckets['101-200ms']++;
      else if (time <= 500) responseTimeBuckets['201-500ms']++;
      else responseTimeBuckets['501ms+']++;
    });

    // Prepare data for charts
    const statusCodesData = {
      labels: Object.keys(metrics.statusCodes).sort(),
      values: Object.keys(metrics.statusCodes).sort().map(code => metrics.statusCodes[code] || 0)
    };

    const methodsData = {
      labels: Object.keys(metrics.methods).sort(),
      values: Object.keys(metrics.methods).sort().map(method => metrics.methods[method] || 0)
    };

    const latencyData = {
      labels: Object.keys(responseTimeBuckets),
      values: Object.values(responseTimeBuckets)
    };

    const backendLoadData = {
      labels: Object.keys(metrics.backendStats),
      values: Object.keys(metrics.backendStats).map(ip => metrics.backendStats[ip].requests || 0)
    };

    return new Response(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reverse Proxy Metrics Dashboard</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: #f8f9fa;
            color: #212529;
            padding: 20px;
          }
          .dashboard {
            max-width: 1400px;
            margin: 0 auto;
          }
          .card {
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            border-radius: 8px;
            margin-bottom: 20px;
            border: none;
          }
          .card-header {
            background-color: #fff;
            border-bottom: 1px solid rgba(0,0,0,0.05);
            font-weight: 600;
          }
          .metric-value {
            font-size: 24px;
            font-weight: 700;
          }
          .metric-label {
            font-size: 14px;
            color: #6c757d;
          }
          .status-indicator {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
          }
          .status-healthy {
            background-color: #d1e7dd;
            color: #0f5132;
          }
          .status-warning {
            background-color: #fff3cd;
            color: #856404;
          }
          .status-danger {
            background-color: #f8d7da;
            color: #842029;
          }
          .chart-container {
            position: relative;
            height: 250px;
            width: 100%;
          }
          .backend-status {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
          }
          .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 8px;
          }
          .healthy { background-color: #10b981; }
          .degraded { background-color: #f59e0b; }
          .down { background-color: #ef4444; }
          .nav-tabs .nav-link {
            border: none;
            color: #6c757d;
          }
          .nav-tabs .nav-link.active {
            border-bottom: 2px solid #0d6efd;
            color: #0d6efd;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="dashboard">
          <div class="d-flex justify-content-between align-items-center mb-4">
            <h1>Reverse Proxy Metrics</h1>
            <div>
              <span class="status-indicator status-healthy">All Systems Operational</span>
              <span class="ms-2 text-muted">Last updated: ${new Date(metrics.lastUpdated).toLocaleString()}</span>
            </div>
          </div>
          
          <div class="row">
            <!-- Summary metrics -->
            <div class="col-md-3">
              <div class="card">
                <div class="card-body text-center">
                  <div class="metric-label">Total Requests</div>
                  <div class="metric-value">${totalRequests.toLocaleString()}</div>
                </div>
              </div>
            </div>
            
            <div class="col-md-3">
              <div class="card">
                <div class="card-body text-center">
                  <div class="metric-label">Avg. Response Time</div>
                  <div class="metric-value">${avgResponseTime}ms</div>
                </div>
              </div>
            </div>
            
            <div class="col-md-3">
              <div class="card">
                <div class="card-body text-center">
                  <div class="metric-label">Success Rate</div>
                  <div class="metric-value">${successRate}%</div>
                </div>
              </div>
            </div>
            
            <div class="col-md-3">
              <div class="card">
                <div class="card-body text-center">
                  <div class="metric-label">Active Backends</div>
                  <div class="metric-value">${activeBackends}/3</div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Traffic Tab Panel -->
          <ul class="nav nav-tabs mt-4" id="myTab" role="tablist">
            <li class="nav-item" role="presentation">
              <button class="nav-link active" id="traffic-tab" data-bs-toggle="tab" data-bs-target="#traffic" type="button" role="tab">Traffic</button>
            </li>
            <li class="nav-item" role="presentation">
              <button class="nav-link" id="backends-tab" data-bs-toggle="tab" data-bs-target="#backends" type="button" role="tab">Backends</button>
            </li>
            <li class="nav-item" role="presentation">
              <button class="nav-link" id="errors-tab" data-bs-toggle="tab" data-bs-target="#errors" type="button" role="tab">Errors</button>
            </li>
          </ul>
          
          <div class="tab-content" id="myTabContent">
            <!-- Traffic Tab -->
            <div class="tab-pane fade show active" id="traffic" role="tabpanel" aria-labelledby="traffic-tab">
              <div class="row mt-4">
                <div class="col-md-6">
                  <div class="card">
                    <div class="card-header">Request Methods</div>
                    <div class="card-body">
                      <canvas id="methods-chart" height="220"></canvas>
                    </div>
                  </div>
                </div>
                
                <div class="col-md-6">
                  <div class="card">
                    <div class="card-header">Response Status Codes</div>
                    <div class="card-body">
                      <canvas id="status-chart" height="220"></canvas>
                    </div>
                  </div>
                </div>
              </div>
              
              <div class="row mt-3">
                <div class="col-md-12">
                  <div class="card">
                    <div class="card-header">Response Time Distribution</div>
                    <div class="card-body">
                      <canvas id="latency-histogram" height="220"></canvas>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Backends Tab -->
            <div class="tab-pane fade" id="backends" role="tabpanel" aria-labelledby="backends-tab">
              <div class="row mt-4">
                <div class="col-md-8">
                  <div class="card">
                    <div class="card-header">Backend Performance</div>
                    <div class="card-body">
                      <table class="table">
                        <thead>
                          <tr>
                            <th>Backend IP</th>
                            <th>Requests</th>
                            <th>Successes</th>
                            <th>Failures</th>
                            <th>Success Rate</th>
                            <th>Avg Response Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${Object.keys(metrics.backendStats).map(ip => {
      const stats = metrics.backendStats[ip];
      const successRate = stats.requests > 0
        ? ((stats.successes / stats.requests) * 100).toFixed(1)
        : '0.0';
      return `
                              <tr>
                                <td>${ip}</td>
                                <td>${stats.requests}</td>
                                <td>${stats.successes}</td>
                                <td>${stats.failures}</td>
                                <td>${successRate}%</td>
                                <td>${Math.round(stats.avgResponseTime)}ms</td>
                              </tr>
                            `;
    }).join('')}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="card">
                    <div class="card-header">Backend Load Distribution</div>
                    <div class="card-body">
                      <canvas id="backend-load-chart" height="220"></canvas>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Errors Tab -->
            <div class="tab-pane fade" id="errors" role="tabpanel" aria-labelledby="errors-tab">
              <div class="row mt-4">
                <div class="col-md-12">
                  <div class="card">
                    <div class="card-header">Recent Errors</div>
                    <div class="card-body p-0">
                      <table class="table table-striped mb-0">
                        <thead>
                          <tr>
                            <th>Timestamp</th>
                            <th>Path</th>
                            <th>Backend</th>
                            <th>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${metrics.errors.slice(-10).reverse().map(error => `
                            <tr>
                              <td>${new Date(error.timestamp).toLocaleString()}</td>
                              <td>${error.path}</td>
                              <td>${error.backend}</td>
                              <td>${error.error}</td>
                            </tr>
                          `).join('')}
                          ${metrics.errors.length === 0 ?
        '<tr><td colspan="4" class="text-center">No errors recorded</td></tr>' : ''}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="mt-4 text-center text-muted">
            <small>Displaying real-time metrics for Bolabaden Reverse Proxy</small>
          </div>
        </div>

        <!-- Required JS libraries -->
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        
        <script>
          // Initialize all charts with real data
          document.addEventListener('DOMContentLoaded', function() {
            // Method distribution pie chart
            new Chart(
              document.getElementById('methods-chart'),
              {
                type: 'pie',
                data: {
                  labels: ${JSON.stringify(methodsData.labels)},
                  datasets: [{
                    data: ${JSON.stringify(methodsData.values)},
                    backgroundColor: [
                      'rgba(13, 110, 253, 0.5)',
                      'rgba(25, 135, 84, 0.5)',
                      'rgba(255, 193, 7, 0.5)',
                      'rgba(220, 53, 69, 0.5)',
                      'rgba(111, 66, 193, 0.5)'
                    ],
                    borderColor: [
                      'rgba(13, 110, 253, 1)',
                      'rgba(25, 135, 84, 1)',
                      'rgba(255, 193, 7, 1)',
                      'rgba(220, 53, 69, 1)',
                      'rgba(111, 66, 193, 1)'
                    ],
                    borderWidth: 1
                  }]
                },
                options: {
                  responsive: true,
                  plugins: {
                    legend: {
                      position: 'right'
                    }
                  }
                }
              }
            );
            
            // Status codes distribution
            new Chart(
              document.getElementById('status-chart'),
              {
                type: 'bar',
                data: {
                  labels: ${JSON.stringify(statusCodesData.labels)},
                  datasets: [{
                    label: 'Status codes',
                    data: ${JSON.stringify(statusCodesData.values)},
                    backgroundColor: [
                      'rgba(25, 135, 84, 0.5)',
                      'rgba(13, 110, 253, 0.5)',
                      'rgba(255, 193, 7, 0.5)',
                      'rgba(220, 53, 69, 0.5)'
                    ],
                    borderColor: [
                      'rgba(25, 135, 84, 1)',
                      'rgba(13, 110, 253, 1)',
                      'rgba(255, 193, 7, 1)',
                      'rgba(220, 53, 69, 1)'
                    ],
                    borderWidth: 1
                  }]
                },
                options: {
                  responsive: true,
                  scales: {
                    y: {
                      beginAtZero: true
                    }
                  },
                  plugins: {
                    legend: {
                      display: false
                    }
                  }
                }
              }
            );
            
            // Response time histogram
            new Chart(
              document.getElementById('latency-histogram'),
              {
                type: 'bar',
                data: {
                  labels: ${JSON.stringify(latencyData.labels)},
                  datasets: [{
                    label: 'Response time',
                    data: ${JSON.stringify(latencyData.values)},
                    backgroundColor: 'rgba(13, 110, 253, 0.5)',
                    borderColor: 'rgba(13, 110, 253, 1)',
                    borderWidth: 1
                  }]
                },
                options: {
                  responsive: true,
                  scales: {
                    y: {
                      beginAtZero: true
                    }
                  },
                  plugins: {
                    legend: {
                      display: false
                    }
                  }
                }
              }
            );
            
            // Backend load distribution
            new Chart(
              document.getElementById('backend-load-chart'),
              {
                type: 'doughnut',
                data: {
                  labels: ${JSON.stringify(backendLoadData.labels)},
                  datasets: [{
                    data: ${JSON.stringify(backendLoadData.values)},
                    backgroundColor: [
                      'rgba(13, 110, 253, 0.5)',
                      'rgba(25, 135, 84, 0.5)',
                      'rgba(111, 66, 193, 0.5)'
                    ],
                    borderColor: [
                      'rgba(13, 110, 253, 1)',
                      'rgba(25, 135, 84, 1)',
                      'rgba(111, 66, 193, 1)'
                    ],
                    borderWidth: 1
                  }]
                },
                options: {
                  responsive: true,
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        boxWidth: 12
                      }
                    }
                  }
                }
              }
            );
            
            // Auto-refresh the page every 30 seconds to get fresh metrics
            setTimeout(function() {
              window.location.reload();
            }, 30000);
          });
        </script>
      </body>
      </html>
    `, {
      headers: { "Content-Type": "text/html" }
    });
  }
};