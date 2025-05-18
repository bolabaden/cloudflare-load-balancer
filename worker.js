// Configuration
const BACKENDS = [
  { ip: "149.130.221.93", name: "VPS1", originHostname: "micklethefickle.bolabaden.org" },
  { ip: "207.211.189.95", name: "VPS2", originHostname: "beatapostapita.bolabaden.org" },
  { ip: "152.117.108.32", name: "VPS3", originHostname: "wizard-pc.bolabaden.org" },
];

// Cloudflare worker domains - requests to these domains won't be proxied
const WORKER_DOMAINS = ["workers.dev", "cloudflareworkers.com"];

// Path for accessing dashboard
const DASHBOARD_PATH = "/dashboard";

// Health check interval in milliseconds (for scheduled task)
// const HEALTH_CHECK_INTERVAL = 60000; // 1 minute - managed by Cron Trigger timing

// In-memory storage for metrics (primarily for dashboard)
let metrics = {
  requests: 0,
  successful: 0,
  failed: 0,
  backendStats: {},
  lastRequests: [],
};

// Store status of backends
let backendStatus = {};

// Initialize backend stats and status
BACKENDS.forEach(backend => {
  metrics.backendStats[backend.name] = {
    requests: 0,
    successful: 0,
    failed: 0,
    responseTimes: [],
    avgResponseTime: 0,
  };

  backendStatus[backend.name] = {
    status: "unknown", // unknown, healthy, unhealthy, error
    lastChecked: null,
    responseTime: null,
    statusCode: null,
    error: null, // Store error message if any
  };
});

/**
 * Export the Worker handlers
 */
export default {
  // Handle HTTP requests - primarily for proxying
  async fetch(request, env, ctx) {
    console.log(`[DEBUG] Incoming request: ${request.method} ${request.url}`);
    const url = new URL(request.url);

    // Serve dashboard if requested on worker's domain
    const isWorkerDomain = WORKER_DOMAINS.some((domain) =>
      url.hostname.endsWith(domain)
    );
    if (isWorkerDomain) {
      if (url.pathname === DASHBOARD_PATH || url.pathname === DASHBOARD_PATH + "/") {
        console.log("[DEBUG] Serving dashboard.");
        return serveDashboard(env);
      }
      return new Response("Worker operational. Access dashboard at /dashboard", { status: 200 });
    }

    // Handle actual proxying for all other cases
    console.log("[DEBUG] Attempting to proxy request.");
    return handleProxyRequest(request, env);
  },

  // Handle scheduled events for health checks and DNS updates
  async scheduled(event, env, ctx) {
    console.log("[INFO] Scheduled event: Running health checks and DNS updates.");
    ctx.waitUntil(testAllBackendsAndUpdateDns(env));
  }
};

/**
 * Main request handler for proxying traffic
 */
async function handleProxyRequest(request, env) {
  const startTime = Date.now();
  const requestId =
    Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const incomingUrl = new URL(request.url); // This is the URL the user is trying to access
  console.log(`[PROXY] Request ${requestId}: ${request.method} ${incomingUrl.toString()}`);

  metrics.requests++;
  metrics.lastRequests.unshift({
    id: requestId,
    timestamp: startTime,
    url: `${incomingUrl.hostname}${incomingUrl.pathname}`,
    status: "pending",
  });
  if (metrics.lastRequests.length > 10) metrics.lastRequests.pop();

  for (const backend of BACKENDS) {
    try {
      metrics.backendStats[backend.name].requests++;
      
      // Clone the request if it might have a body that can be consumed.
      // This is crucial for retrying POST/PUT requests.
      let requestToForward = request;
      if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH' || request.method === 'DELETE') {
        // For methods that can have a body, clone the original request for each attempt
        // to ensure the body stream is not disturbed.
        requestToForward = request.clone();
      }

      // The target URL for fetch is the original incoming URL.
      // The connection will be directed to the IP resolved from backend.originHostname.
      // SNI and Host header will derive from incomingUrl.hostname.
      console.log(`[PROXY] Request ${requestId}: Trying backend ${backend.name} (${backend.ip}) for URL ${incomingUrl.toString()}, resolving via ${backend.originHostname}`);

      const subRequestHeaders = new Headers();

      // Set critical headers first
      // Host header should be the original incoming host, matching SNI for this approach
      subRequestHeaders.set('Host', incomingUrl.hostname); 
      subRequestHeaders.set('X-Forwarded-For', requestToForward.headers.get('CF-Connecting-IP') || requestToForward.headers.get('X-Real-IP') || '');
      subRequestHeaders.set('X-Forwarded-Proto', incomingUrl.protocol.slice(0, -1));
      if (requestToForward.headers.get('CF-Connecting-IP')) {
        // Also pass CF-Connecting-IP if you have systems that look for it directly
        subRequestHeaders.set('CF-Connecting-IP', requestToForward.headers.get('CF-Connecting-IP'));
      }


      const headersToSkip = ['host', 'x-forwarded-for', 'x-forwarded-proto', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'connection', 'x-real-ip'];
      for (const [key, value] of requestToForward.headers.entries()) {
        if (!headersToSkip.includes(key.toLowerCase()) && !subRequestHeaders.has(key)) {
          subRequestHeaders.append(key, value);
        }
      }

      console.log(`[PROXY] Request ${requestId}: Sub-request to ${incomingUrl.hostname} (resolving via ${backend.originHostname} to ${backend.ip}). Host header: ${subRequestHeaders.get('Host')}`);

      const subRequest = new Request(incomingUrl.toString(), {
        method: requestToForward.method, // Use method from cloned/original request
        headers: subRequestHeaders,      // Use newly constructed headers
        body: requestToForward.body,       // Use body from cloned/original request
        redirect: requestToForward.redirect, // Use redirect from cloned/original request
        cf: {
          resolveOverride: backend.originHostname // Directs the TCP connection to the IP of this hostname
                               // SNI will be incomingUrl.hostname
                               // Host header (from subRequestHeaders) is also incomingUrl.hostname
        }
      });
      
      const backendStartTime = Date.now();
      const response = await fetch(subRequest);
      const backendResponseTime = Date.now() - backendStartTime;

      console.log(`[PROXY] Request ${requestId}: Backend ${backend.name} responded from ${incomingUrl.hostname} (via ${backend.ip}): Status ${response.status}, Time ${backendResponseTime}ms`);

      const reqHistory = metrics.lastRequests.find(r => r.id === requestId);
      if (reqHistory) {
        reqHistory.backend = backend.name;
        reqHistory.responseTime = backendResponseTime;
        reqHistory.status = response.status;
      }

      if (response.status >= 200 && response.status < 400) {
        metrics.successful++;
        metrics.backendStats[backend.name].successful++;
        console.log(`[PROXY] Request ${requestId}: Successfully proxied to ${backend.name} for ${incomingUrl.hostname}.`);
        return response;
      }

      console.warn(`[PROXY] Request ${requestId}: Backend ${backend.name} (for ${incomingUrl.hostname}) returned non-success status: ${response.status}`);
      metrics.failed++;
      metrics.backendStats[backend.name].failed++;

      if ((response.status === 401 || response.status === 403 || response.status === 422)) {
        console.warn(`[PROXY] Request ${requestId}: Returning ${response.status} from ${backend.name} for ${incomingUrl.hostname}. Not trying other backends.`);
        return response;
      }
      console.log(`[PROXY] Request ${requestId}: Backend ${backend.name} for ${incomingUrl.hostname} returned ${response.status}, trying next backend.`);

    } catch (error) {
      console.error(`[PROXY] Request ${requestId}: Error connecting to backend ${backend.name} (${backend.ip}) for ${incomingUrl.hostname}:`, error.message, error.stack ? error.stack.split('\n')[0] : '');
      metrics.failed++;
      metrics.backendStats[backend.name].failed++;
      const reqHistory = metrics.lastRequests.find(r => r.id === requestId);
      if (reqHistory) {
        reqHistory.backend = backend.name;
        reqHistory.status = "error";
        reqHistory.error = error.message;
      }
    }
  }

  const totalTime = Date.now() - startTime;
  console.error(`[PROXY] Request ${requestId}: All backends failed for URL: ${incomingUrl.toString()}. Total time: ${totalTime}ms`);
  const reqHistory = metrics.lastRequests.find(r => r.id === requestId);
  if (reqHistory) {
    reqHistory.status = "all_failed";
    reqHistory.responseTime = totalTime;
  }

  return new Response("Service Unavailable - All backends failed", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Perform health checks on all backends and then update DNS records.
 * This is intended to be called by the scheduled event.
 */
async function testAllBackendsAndUpdateDns(env) {
  const { HEALTH_CHECK_PATH } = env; // HEALTH_CHECK_DOMAIN is no longer needed here directly

  if (!HEALTH_CHECK_PATH) {
    console.error("[ERROR] Missing HEALTH_CHECK_PATH environment variable for health checks.");
    return;
  }
   // DNS variables check remains in updateDnsRecords

  console.log("[INFO] Starting health checks for all backends...");
  const healthCheckPromises = BACKENDS.map(async (backend) => {
    const startTime = Date.now();
    // Health check now uses the backend.originHostname
    const healthUrl = `https://${backend.originHostname}${HEALTH_CHECK_PATH}`;
    
    try {
      console.log(`[HEALTH] Checking ${backend.name} (${backend.ip}) via ${healthUrl}`);
      
      const subRequestHeaders = new Headers();
      // For health checks, the Host header should match the backend.originHostname, 
      // or your backend should be configured to respond to the health check path on any Host.
      // Let's set it to backend.originHostname for clarity.
      subRequestHeaders.set('Host', backend.originHostname);
      subRequestHeaders.set('User-Agent', 'CloudflareWorkerHealthCheck/1.1');
      subRequestHeaders.set('Cache-Control', 'no-cache');

      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: subRequestHeaders,
        // No resolveOverride needed as we are fetching the originHostname directly
      });
      const responseTime = Date.now() - startTime;
      const isHealthy = response.status >= 200 && response.status < 400;

      console.log(`[HEALTH] Backend ${backend.name}: Status ${response.status}, Time ${responseTime}ms, Healthy: ${isHealthy}`);
      backendStatus[backend.name] = {
        status: isHealthy ? "healthy" : "unhealthy",
        lastChecked: Date.now(),
        responseTime: responseTime,
        statusCode: response.status,
        error: isHealthy ? null : `Status ${response.status}`,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      console.error(`[HEALTH] Error checking backend ${backend.name} (${backend.ip}) via ${healthUrl}:`, error.message);
      backendStatus[backend.name] = {
        status: "error",
        lastChecked: Date.now(),
        responseTime: responseTime,
        statusCode: null,
        error: error.message,
      };
    }
  });

  await Promise.all(healthCheckPromises);
  console.log("[INFO] All backend health checks complete. Status:", JSON.stringify(backendStatus, null, 2));
  await updateDnsRecords(env);
}

/**
 * Update DNS records based on backend health.
 */
async function updateDnsRecords(env) {
  const { DNS_ZONE_ID, DNS_API_TOKEN, DNS_RECORD_NAME, FALLBACK_IP } = env;
  if (!DNS_ZONE_ID || !DNS_API_TOKEN || !DNS_RECORD_NAME) {
    console.error("[ERROR] DNS Update: Missing DNS_ZONE_ID, DNS_API_TOKEN, or DNS_RECORD_NAME.");
    return;
  }

  const healthyBackends = BACKENDS.filter(b => backendStatus[b.name]?.status === "healthy");
  let desiredIPs = new Set(healthyBackends.map(b => b.ip));

  if (desiredIPs.size === 0 && FALLBACK_IP) {
    console.warn(`[DNS] All primary backends unhealthy. Using FALLBACK_IP: ${FALLBACK_IP} for ${DNS_RECORD_NAME}`);
    desiredIPs = new Set([FALLBACK_IP]);
  } else if (desiredIPs.size === 0) {
    console.warn(`[DNS] No healthy backends and no FALLBACK_IP. DNS records for ${DNS_RECORD_NAME} may be cleared or left as is, depending on existing records.`);
    // If desiredIPs is empty, all existing records matching DNS_RECORD_NAME will be removed.
  }
   console.log(`[DNS] Desired IPs for ${DNS_RECORD_NAME}: ${[...desiredIPs].join(', ')} || 'NONE'`);

  const apiBase = `https://api.cloudflare.com/client/v4/zones/${DNS_ZONE_ID}/dns_records`;
  const cfApiHeaders = { Authorization: `Bearer ${DNS_API_TOKEN}`, 'Content-Type': 'application/json' };

  try {
    const listResponse = await fetch(`${apiBase}?type=A&name=${DNS_RECORD_NAME}`, { headers: cfApiHeaders });
    if (!listResponse.ok) {
      console.error(`[DNS] Failed to list DNS records for ${DNS_RECORD_NAME}. Status: ${listResponse.status}, Response: ${await listResponse.text()}`);
      return;
    }
    const listResult = await listResponse.json();
    if (!listResult.success) {
      console.error(`[DNS] Error listing DNS records for ${DNS_RECORD_NAME}:`, JSON.stringify(listResult.errors));
      return;
    }

    const currentARecords = listResult.result;
    const currentIPs = new Set(currentARecords.map(r => r.content));
    console.log(`[DNS] Current IPs for ${DNS_RECORD_NAME}: ${[...currentIPs].join(', ')} || 'NONE'`);

    const recordsToRemove = currentARecords.filter(r => !desiredIPs.has(r.content));
    for (const record of recordsToRemove) {
      console.log(`[DNS] Removing DNS record ID ${record.id} (IP ${record.content}) for ${DNS_RECORD_NAME}`);
      const deleteResponse = await fetch(`${apiBase}/${record.id}`, { method: 'DELETE', headers: cfApiHeaders });
      console.log(`[DNS] Remove for ${record.content}: ${deleteResponse.ok ? 'Success' : `Fail (${deleteResponse.status} ${await deleteResponse.text()})`}`);
    }

    const ipsToAdd = [...desiredIPs].filter(ip => !currentIPs.has(ip));
    for (const ip of ipsToAdd) {
      console.log(`[DNS] Adding DNS record for IP ${ip} to ${DNS_RECORD_NAME}`);
      const addResponse = await fetch(apiBase, {
        method: 'POST',
        headers: cfApiHeaders,
        body: JSON.stringify({ type: 'A', name: DNS_RECORD_NAME, content: ip, ttl: 60, proxied: false }),
      });
      console.log(`[DNS] Add for ${ip}: ${addResponse.ok ? 'Success' : `Fail (${addResponse.status} ${JSON.stringify(await addResponse.json())})`}`);
    }
    console.log(`[DNS] DNS update for ${DNS_RECORD_NAME} complete.`);

  } catch (error) {
    console.error(`[DNS] Unexpected error during DNS update for ${DNS_RECORD_NAME}:`, error.message, error.stack);
  }
}

/**
 * Serve the dashboard page
 */
function serveDashboard(env) {
  let healthyCount = 0;
  for (const backend of BACKENDS) {
    if (backendStatus[backend.name]?.status === "healthy") {
      healthyCount++;
    }
  }

  const systemStatus =
    healthyCount === 0
      ? "critical"
      : healthyCount < BACKENDS.length
        ? "degraded"
        : "operational";

  const successRate = metrics.requests
    ? Math.round((metrics.successful / metrics.requests) * 100)
    : 0;

  const formatTime = (ts) => ts ? new Date(ts).toLocaleString() : "Never";

  const formatStatus = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown";

  const getStatusColor = (s) => ({
    healthy: "#10B981", operational: "#10B981",
    unhealthy: "#EF4444", critical: "#EF4444",
    error: "#F59E0B", degraded: "#F59E0B",
    pending: "#6B7280", all_failed: "#EF4444", unknown: "#6B7280"
  }[s] || "#6B7280");

  return new Response(String.raw`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Failover System Status</title>
    <style>
      :root { --bg-color: #111827; --card-bg: #1F2937; --border-color: #374151; --text-color: #F9FAFB; --text-muted: #9CA3AF; --green: #10B981; --red: #EF4444; --amber: #F59E0B; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"; background-color: var(--bg-color); color: var(--text-color); padding: 1rem; line-height: 1.6; font-size: 16px; }
      .container { max-width: 1200px; margin: 0 auto; }
      .header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-color); }
      .header h1 { margin-right: 1rem; margin-bottom: 0.5rem; }
      .system-status-card { padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem; }
      .status-badge { display: inline-flex; align-items: center; padding: 0.3em 0.7em; border-radius: 9999px; font-weight: 600; font-size: 0.875em; }
      .status-badge::before { content: ""; display: inline-block; width: 0.5em; height: 0.5em; border-radius: 9999px; margin-right: 0.5em; background-color: currentColor; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
      .card { background-color: var(--card-bg); border-radius: 0.5rem; padding: 1rem; border: 1px solid var(--border-color); display: flex; flex-direction: column; }
      .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color); }
      .card-title { font-size: 1.125em; font-weight: 600; }
      .metric { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color); font-size: 0.9em; }
      .metric:last-child { border-bottom: none; }
      .metric-label { color: var(--text-muted); }
      .metric-value { font-weight: 500; text-align: right; }
      .error-message { color: var(--red); font-size: 0.8em; word-break: break-all; max-height: 60px; overflow-y: auto; }
      table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; font-size: 0.9em; }
      th, td { padding: 0.75em; text-align: left; border-bottom: 1px solid var(--border-color); }
      th { font-weight: 600; color: var(--text-muted); }
      .pill { display: inline-block; padding: 0.25em 0.6em; border-radius: 9999px; font-size: 0.8em; font-weight: 600; white-space: nowrap; }
      .auto-refresh { color: var(--text-muted); font-size: 0.875em; text-align: center; margin-top: 1.5rem; }
      td span.pill { font-size: 1em; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Failover System Status</h1>
        <div style="font-size: 0.9em;">${new Date().toLocaleString()}</div>
      </div>
      <div class="system-status-card" style="background-color: ${getStatusColor(systemStatus)}22;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
          <div style="margin-bottom: 0.5rem;">
            <span class="status-badge" style="color: ${getStatusColor(systemStatus)};">System ${systemStatus.toUpperCase()}</span>
            <div>${healthyCount} of ${BACKENDS.length} backends healthy (via scheduled checks)</div>
          </div>
          <div style="text-align: right;">
            <div class="metric-value">${successRate}% Success Rate</div>
            <div>${metrics.successful} proxied / ${metrics.requests} total by this worker</div>
          </div>
        </div>
      </div>
      <h2>Backend Status</h2>
      <p style="color: var(--text-muted); font-size: 0.9em; margin-bottom: 1rem;">DNS Record for Load Balancing: <strong>${env.DNS_RECORD_NAME || "Not Configured"}</strong> (updated by schedule)</p>
      <div class="grid">
        ${BACKENDS.map(backend => {
          const statusInfo = backendStatus[backend.name] || { status: "unknown", statusCode: 'N/A', responseTime: 'N/A', lastChecked: null, error: null };
          const statusColor = getStatusColor(statusInfo.status);
          const backendMetrics = metrics.backendStats[backend.name] || { requests: 0, successful: 0, avgResponseTime: 0 };
          const backendSuccessRate = backendMetrics.requests ? Math.round((backendMetrics.successful / backendMetrics.requests) * 100) : 0;
          return String.raw`
            <div class="card">
              <div class="card-header">
                <div class="card-title">${backend.name}</div>
                <span class="status-badge" style="color: ${statusColor};">${formatStatus(statusInfo.status)}</span>
              </div>
              <div class="metric"><span class="metric-label">IP Address</span><span class="metric-value">${backend.ip}</span></div>
              <div class="metric"><span class="metric-label">Origin Hostname</span><span class="metric-value">${backend.originHostname}</span></div>
              <div class="metric"><span class="metric-label">Last Health Check</span><span class="metric-value">${formatTime(statusInfo.lastChecked)}</span></div>
              <div class="metric"><span class="metric-label">Health Status Code</span><span class="metric-value">${statusInfo.statusCode || 'N/A'}</span></div>
              <div class="metric"><span class="metric-label">Health Latency</span><span class="metric-value">${statusInfo.responseTime !== null ? statusInfo.responseTime + 'ms' : 'N/A'}</span></div>
              ${statusInfo.error ? `<div class="metric"><span class="metric-label">Last Error</span><span class="metric-value error-message">${statusInfo.error.substring(0,30)}${statusInfo.error.length > 30 ? '...' : ''}</span></div>` : ''}
              <div style="margin-top:1rem; padding-top: 0.5rem; border-top: 1px solid var(--border-color);">
                 <div class="metric-label" style="font-size:0.9rem; margin-bottom:0.25rem;">Proxied Traffic by Worker:</div>
                 <div class="metric"><span class="metric-label">Requests</span><span class="metric-value">${backendMetrics.requests}</span></div>
                 <div class="metric"><span class="metric-label">Success Rate</span><span class="metric-value">${backendSuccessRate}%</span></div>
                 <div class="metric"><span class="metric-label">Avg. Latency</span><span class="metric-value">${Math.round(backendMetrics.avgResponseTime) || 0}ms</span></div>
              </div>
            </div>`;
        }).join("")}
      </div>
      <h2>Recent Proxied Requests (last 10 by this worker instance)</h2>
      <div class="card" style="overflow-x: auto;">
        <table><thead><tr><th>Time</th><th>URL</th><th>Backend</th><th>Status</th><th>Latency</th></tr></thead>
          <tbody>
            ${metrics.lastRequests.map(req => {
              const statusType = req.status === "pending" ? "pending"
                : (req.status >= 200 && req.status < 400) ? "healthy"
                  : (req.status === "error" || req.status === "all_failed") ? "error"
                    : "unhealthy";
              const reqStatusColor = getStatusColor(statusType);
              return String.raw`<tr>
                  <td>${formatTime(req.timestamp)}</td>
                  <td style="word-break:break-all;">${req.url}</td>
                  <td>${req.backend || "-"}</td>
                  <td><span class="pill" style="background-color: ${reqStatusColor}22; color: ${reqStatusColor};">${req.error ? `Error: ${req.error.substring(0,30)}${req.error.length > 30 ? '...' : ''}` : (req.status || 'N/A')}</span></td>
                  <td>${req.responseTime ? req.responseTime + "ms" : "-"}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <p class="auto-refresh">Dashboard auto-refreshes every 30 seconds. Backend health & DNS updated by schedule (e.g., every minute via Cron Trigger).</p>
    </div>
    <script>setTimeout(() => window.location.reload(), 30000);</script>
  </body></html>`);
}

// Note: The original testAllBackends function is effectively replaced by testAllBackendsAndUpdateDns
// and the DNS update logic is now within updateDnsRecords.
