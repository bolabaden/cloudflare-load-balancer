import {
  LoadBalancerServiceConfig,
  StoredState,
  Backend,
  UpdateServiceConfigRequest,
  ServiceMetrics,
  BackendMetrics,
} from "./types";

export class LoadBalancerDO implements DurableObject {
  state: DurableObjectState;
  env: Env;
  config!: LoadBalancerServiceConfig; // Loaded in constructor
  metrics!: ServiceMetrics; // Initialized in constructor
  initialized: boolean = false;
  serviceHostname: string; // The hostname this DO instance is responsible for

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.serviceHostname = state.id.name || "default-service"; 

    this.state.blockConcurrencyWhile(async () => {
      await this.loadState();
      // Ensure an alarm is set if active health checks are enabled
      if (this.config?.activeHealthChecks?.enabled && this.config.activeHealthChecks.intervalMs > 0) {
        const currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm == null) {
            console.log(`[${this.serviceHostname}] Setting initial alarm for active health checks.`);
            this.state.storage.setAlarm(Date.now() + this.config.activeHealthChecks.intervalMs);
        }
      }
    });
  }

  private async initializeEmptyConfig(serviceId: string) {
    console.log(`[${serviceId}] Initializing empty configuration. Service must be configured via API before handling traffic.`);
    this.config = {
        serviceId: serviceId,
        backends: [],
        currentRoundRobinIndex: 0,
        sessionAffinity: { type: 'none' },
        passiveHealthChecks: { maxFailures: 3, failureTimeoutMs: 30000, retryableStatusCodes: [500, 502, 503, 504] },
        activeHealthChecks: { enabled: false, path: "/healthz", intervalMs: 60000, timeoutMs: 5000, expectedStatusCode: 200 },
        retryPolicy: { maxRetries: 1 },
        hostHeaderRewrite: 'preserve',
        observability: { responseHeaderName: "X-CF-Backend-Used" }
    };
    await this.saveConfig();
  }

  private async loadState() {
    const stored = await this.state.storage.get<StoredState>("state");
    if (stored && stored.config) {
      this.config = stored.config;
      this.config.backends.forEach(b => { // Ensure metric fields exist if loaded from older state
        b.requests = b.requests ?? 0;
        b.successfulRequests = b.successfulRequests ?? 0;
        b.failedRequests = b.failedRequests ?? 0;
        b.totalResponseTimeMs = b.totalResponseTimeMs ?? 0;
      });
    } else {
      await this.initializeEmptyConfig(this.serviceHostname);
    }

    this.metrics = await this.state.storage.get<ServiceMetrics>("metrics") || {
        serviceId: this.config.serviceId,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0,
        backendMetrics: {},
    };

    let runningTotalRequests = 0, runningTotalSuccess = 0, runningTotalFailed = 0;
    this.config.backends.forEach(backend => {
        if (!this.metrics.backendMetrics[backend.id]) {
            this.metrics.backendMetrics[backend.id] = {
                requests: backend.requests || 0, successfulRequests: backend.successfulRequests || 0,
                failedRequests: backend.failedRequests || 0, totalResponseTimeMs: backend.totalResponseTimeMs || 0,
                avgResponseTimeMs: 0, 
            };
        }
        runningTotalRequests += this.metrics.backendMetrics[backend.id].requests;
        runningTotalSuccess += this.metrics.backendMetrics[backend.id].successfulRequests;
        runningTotalFailed += this.metrics.backendMetrics[backend.id].failedRequests;
    });
    this.metrics.totalRequests = Math.max(this.metrics.totalRequests, runningTotalRequests);
    this.metrics.totalSuccessfulRequests = Math.max(this.metrics.totalSuccessfulRequests, runningTotalSuccess);
    this.metrics.totalFailedRequests = Math.max(this.metrics.totalFailedRequests, runningTotalFailed);

    this.calculateAvgResponseTimes();
    this.initialized = true;
    console.log(`[${this.serviceHostname}] DO Initialized. Config loaded for serviceId: ${this.config.serviceId}. Backends: ${this.config.backends.length}`);
  }

  private async saveConfig() {
    if (!this.config) return;
    const stateToStore: StoredState = { config: this.config };
    await this.state.storage.put("state", stateToStore);
  }

  private async saveMetrics() {
    await this.state.storage.put("metrics", this.metrics);
  }

  private calculateAvgResponseTimes() {
    for (const backendId in this.metrics.backendMetrics) {
      const bm = this.metrics.backendMetrics[backendId];
      bm.avgResponseTimeMs = bm.successfulRequests > 0 ? bm.totalResponseTimeMs / bm.successfulRequests : 0;
    }
  }

  private recordMetric(backendId: string, success: boolean, durationMs: number) {
    this.metrics.totalRequests++;
    if (!this.metrics.backendMetrics[backendId]) {
      const backendExistsInConfig = this.config.backends.find(b => b.id === backendId);
      if (backendExistsInConfig) {
        this.metrics.backendMetrics[backendId] = { requests: 0, successfulRequests: 0, failedRequests: 0, totalResponseTimeMs: 0, avgResponseTimeMs: 0 };
      } else {
        console.error(`Attempted to record metric for unknown backendId: ${backendId} in service ${this.serviceHostname}`);
        return;
      }
    }

    const backendMetric = this.metrics.backendMetrics[backendId];
    backendMetric.requests++;
    backendMetric.lastRequestTimestamp = Date.now();

    if (success) {
      this.metrics.totalSuccessfulRequests++;
      backendMetric.successfulRequests++;
      backendMetric.totalResponseTimeMs += durationMs;
      backendMetric.avgResponseTimeMs = backendMetric.totalResponseTimeMs / backendMetric.successfulRequests;
      backendMetric.lastSuccessTimestamp = Date.now();
    } else {
      this.metrics.totalFailedRequests++;
      backendMetric.failedRequests++;
      backendMetric.lastFailureTimestamp = Date.now();
    }

    const backendInConfig = this.config.backends.find(b => b.id === backendId);
    if (backendInConfig) {
      backendInConfig.requests = backendMetric.requests;
      backendInConfig.successfulRequests = backendMetric.successfulRequests;
      backendInConfig.failedRequests = backendMetric.failedRequests;
      backendInConfig.totalResponseTimeMs = backendMetric.totalResponseTimeMs;
    }
    this.state.waitUntil(this.saveMetrics());
    this.state.waitUntil(this.saveConfig());
  }

  private getClientIp(request: Request): string | null {
    return request.headers.get("CF-Connecting-IP");
  }

  private selectBackend(request: Request): Backend | null {
    if (!this.config || !this.config.backends || this.config.backends.length === 0) {
      console.warn(`[${this.serviceHostname}] SelectBackend: No backends configured.`);
      return null;
    }

    // 1. Session Affinity Check
    if (this.config.sessionAffinity.type !== 'none') {
        let stickyBackendId: string | null = null;
        if (this.config.sessionAffinity.type === 'cookie' && this.config.sessionAffinity.cookieName) {
            const cookieHeader = request.headers.get("Cookie");
            if (cookieHeader) {
                const cookies = cookieHeader.split(';');
                for (const cookie of cookies) {
                    const [name, value] = cookie.trim().split('=');
                    if (name === this.config.sessionAffinity.cookieName) {
                        stickyBackendId = value;
                        break;
                    }
                }
            }
        } else if (this.config.sessionAffinity.type === 'ip') {
            const clientIp = this.getClientIp(request);
            if (clientIp) {
                let hash = 0;
                for (let i = 0; i < clientIp.length; i++) { hash = ((hash << 5) - hash) + clientIp.charCodeAt(i); hash |= 0; }
                const availableBackendsForIpHash = this.config.backends.filter(b => b.healthy || (Date.now() - (b.lastFailureTimestamp || 0) > this.config.passiveHealthChecks.failureTimeoutMs) );
                if (availableBackendsForIpHash.length > 0) {
                  stickyBackendId = availableBackendsForIpHash[Math.abs(hash) % availableBackendsForIpHash.length].id;
                }
            }
        }

        if (stickyBackendId) {
            const stickyBackend = this.config.backends.find(b => b.id === stickyBackendId);
            if (stickyBackend && (stickyBackend.healthy || (Date.now() - (stickyBackend.lastFailureTimestamp || 0) > this.config.passiveHealthChecks.failureTimeoutMs))) {
                if (!stickyBackend.healthy) { // Revive if timeout passed
                    stickyBackend.healthy = true; stickyBackend.consecutiveFailures = 0;
                    console.log(`[${this.serviceHostname}] Affinity: Revived ${stickyBackend.id}`);
                }
                console.log(`[${this.serviceHostname}] Affinity: Using backend ${stickyBackend.id}`);
                return stickyBackend;
            } else if (stickyBackend && !stickyBackend.healthy){
                 console.log(`[${this.serviceHostname}] Affinity: Sticky backend ${stickyBackend.id} is unhealthy, falling back.`);
            }
        }
    }

    let configChangedDueToHealthRevival = false;
    const healthyBackends = this.config.backends.filter(b => {
        if (b.healthy) return true;
        if (Date.now() - (b.lastFailureTimestamp || 0) > this.config.passiveHealthChecks.failureTimeoutMs) {
            console.log(`[${this.serviceHostname}] Select: Backend ${b.id} failure timeout expired. Marking as healthy.`);
            b.healthy = true; b.consecutiveFailures = 0; configChangedDueToHealthRevival = true;
            return true;
        }
        return false;
    });

    if (healthyBackends.length === 0) {
      if(configChangedDueToHealthRevival) this.state.waitUntil(this.saveConfig()); // Save revivals before returning null
      console.warn(`[${this.serviceHostname}] SelectBackend: No healthy backends remain after filtering.`);
      return null;
    }
    
    // Implement proper weighted round-robin
    const hasWeights = healthyBackends.some(b => b.weight !== 1);
    let selected: Backend;

    if (hasWeights) {
      // Weighted round-robin: calculate total weight and use weighted selection
      const totalWeight = healthyBackends.reduce((sum, b) => sum + b.weight, 0);
      const weightedIndex = this.config.currentRoundRobinIndex % totalWeight;
      
      let currentWeight = 0;
      selected = healthyBackends[0]; // fallback
      for (const backend of healthyBackends) {
        currentWeight += backend.weight;
        if (weightedIndex < currentWeight) {
          selected = backend;
          break;
        }
      }
      this.config.currentRoundRobinIndex = (this.config.currentRoundRobinIndex + 1) % totalWeight;
    } else {
      // Simple round-robin when all weights are equal
      this.config.currentRoundRobinIndex = (this.config.currentRoundRobinIndex + 1) % healthyBackends.length;
      selected = healthyBackends[this.config.currentRoundRobinIndex];
    }

    if(configChangedDueToHealthRevival) this.state.waitUntil(this.saveConfig()); // Save index and any revived health status
    else this.state.waitUntil(this.state.storage.put("state.currentRoundRobinIndex", this.config.currentRoundRobinIndex)); // Optimization: save only index if no health changes

    return selected;
  }

  private async forwardRequest(request: Request, backend: Backend, attempt: number = 0): Promise<Response> {
    const requestStartTime = Date.now();
    let response: Response;
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined;

    // Check if this is a WebSocket upgrade request
    const isWebSocketUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";

    // Define non-idempotent methods that should be retried more carefully
    const nonIdempotentMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const isNonIdempotent = nonIdempotentMethods.includes(request.method.toUpperCase());

    try {
      const backendUrl = new URL(request.url);
      const targetBackendUrl = new URL(backend.url);
      backendUrl.hostname = targetBackendUrl.hostname;
      backendUrl.port = targetBackendUrl.port;
      backendUrl.protocol = targetBackendUrl.protocol;
      // Preserve path and query from original request
      backendUrl.pathname = new URL(request.url).pathname;
      backendUrl.search = new URL(request.url).search;
      
      const clonedRequest = new Request(backendUrl.toString(), request);

      if (this.config.hostHeaderRewrite === 'backend_hostname') {
        clonedRequest.headers.set('Host', targetBackendUrl.hostname);
      } else if (this.config.hostHeaderRewrite !== 'preserve' && this.config.hostHeaderRewrite) {
        clonedRequest.headers.set('Host', this.config.hostHeaderRewrite);
      }
      
      const clientIp = this.getClientIp(request);
      let xff = clonedRequest.headers.get("X-Forwarded-For") || "";
      if (clientIp) { xff = xff ? `${clientIp}, ${xff}` : clientIp; }
      if (xff) clonedRequest.headers.set("X-Forwarded-For", xff);
      clonedRequest.headers.set("X-Forwarded-Proto", new URL(request.url).protocol.slice(0, -1));
      if (clientIp) clonedRequest.headers.set("X-Real-IP", clientIp);

      const controller = new AbortController();
      const timeoutMs = this.config.activeHealthChecks?.timeoutMs || 15000; // Default 15s request timeout
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      console.log(`[${this.serviceHostname}] Attempt ${attempt}: Fetching ${clonedRequest.url} (Host: ${clonedRequest.headers.get('Host')})`);
      
      // For WebSocket upgrades, we need to handle them specially
      if (isWebSocketUpgrade) {
        // WebSocket upgrades should be handled by Cloudflare Workers automatically
        // Just pass through the request without modification
        response = await fetch(clonedRequest, { signal: controller.signal, cf: { apps: false } });
      } else {
        response = await fetch(clonedRequest, { signal: controller.signal, cf: { apps: false } });
      }
      
      clearTimeout(timeoutId);

      const requestEndTime = Date.now();
      this.recordMetric(backend.id, response.ok && response.status < 400, requestEndTime - requestStartTime);

      if (response.ok || (response.status < 500 && !this.config.passiveHealthChecks.retryableStatusCodes.includes(response.status)) ) {
        if (backend.consecutiveFailures > 0 || !backend.healthy) {
            console.log(`[${this.serviceHostname}] Backend ${backend.id} healthy again after success.`);
            backend.consecutiveFailures = 0; backend.healthy = true; backend.status = "Healthy";
            this.state.waitUntil(this.saveConfig());
        }
      } else if (this.config.passiveHealthChecks.retryableStatusCodes.includes(response.status)) {
        backend.consecutiveFailures++; backend.lastFailureTimestamp = Date.now(); backend.status = `Failed (status ${response.status})`;
        console.warn(`[${this.serviceHostname}] Backend ${backend.id} fail status ${response.status}. Consecutive: ${backend.consecutiveFailures}`);
        if (backend.consecutiveFailures >= this.config.passiveHealthChecks.maxFailures) {
          backend.healthy = false; backend.status = `Unhealthy (status ${response.status}, ${backend.consecutiveFailures} fails)`;
          console.error(`[${this.serviceHostname}] Backend ${backend.id} marked unhealthy.`);
        }
        this.state.waitUntil(this.saveConfig());

        // Be more conservative about retrying non-idempotent methods
        const shouldRetry = attempt < this.config.retryPolicy.maxRetries && 
                          (!isNonIdempotent || response.status >= 502); // Only retry non-idempotent on server errors (502+)

        if (shouldRetry) {
            if (isNonIdempotent) {
                console.log(`[${this.serviceHostname}] Retrying ${request.method} request cautiously (server error ${response.status}). Attempt ${attempt + 1}/${this.config.retryPolicy.maxRetries}`);
            } else {
                console.log(`[${this.serviceHostname}] Retrying request. Attempt ${attempt + 1}/${this.config.retryPolicy.maxRetries}`);
            }
            
            const nextBackend = this.selectBackend(request); 
            if (nextBackend && nextBackend.id !== backend.id) { 
                return this.forwardRequest(request, nextBackend, attempt + 1);
            } else if (nextBackend && nextBackend.id === backend.id && this.config.backends.filter(b=>b.healthy || (Date.now()-(b.lastFailureTimestamp||0) > this.config.passiveHealthChecks.failureTimeoutMs)).length ===1 ) {
                console.warn(`[${this.serviceHostname}] Only one backend (${backend.id}) available, retrying on same.`);
                return this.forwardRequest(request, nextBackend, attempt + 1);
            } else if (!nextBackend) { console.warn(`[${this.serviceHostname}] No other backend to retry on.`); }
        } else if (isNonIdempotent && attempt < this.config.retryPolicy.maxRetries) {
            console.warn(`[${this.serviceHostname}] Not retrying ${request.method} request due to non-server error status ${response.status}`);
        }
      }
      
      const newHeaders = new Headers(response.headers);
      if (this.config.observability.responseHeaderName) {
        newHeaders.set(this.config.observability.responseHeaderName, backend.url);
      }
      if (this.config.sessionAffinity.type === 'cookie' && this.config.sessionAffinity.cookieName && !isWebSocketUpgrade) {
        const cookieValue = backend.id;
        const cookieTTL = this.config.sessionAffinity.cookieTTLSeconds || 3600;
        newHeaders.append("Set-Cookie", `${this.config.sessionAffinity.cookieName}=${cookieValue}; Path=/; Max-Age=${cookieTTL}; HttpOnly; SameSite=Lax`);
      }

      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });

    } catch (error: any) {
      if(timeoutId !== undefined) clearTimeout(timeoutId);
      const requestEndTime = Date.now();
      this.recordMetric(backend.id, false, requestEndTime - requestStartTime);
      const errorType = error.name === 'AbortError' ? 'Timeout' : 'ConnFail';
      console.error(`[${this.serviceHostname}] Fetch Error backend ${backend.url}: ${error.message} (${errorType})`, error.stack);

      backend.consecutiveFailures++; backend.lastFailureTimestamp = Date.now(); backend.status = `Error (${errorType})`;
      if (backend.consecutiveFailures >= this.config.passiveHealthChecks.maxFailures) {
        backend.healthy = false; backend.status = `Unhealthy (${errorType}, ${backend.consecutiveFailures} fails)`;
        console.error(`[${this.serviceHostname}] Backend ${backend.id} marked unhealthy due to fetch error.`);
      }
      this.state.waitUntil(this.saveConfig());

      // Be more conservative about retrying non-idempotent methods on connection errors too
      const shouldRetry = attempt < this.config.retryPolicy.maxRetries && 
                        (!isNonIdempotent || errorType === 'Timeout'); // Retry non-idempotent only on timeout, not connection failures

      if (shouldRetry) {
        if (isNonIdempotent) {
            console.log(`[${this.serviceHostname}] Retrying ${request.method} request cautiously after ${errorType}. Attempt ${attempt + 1}/${this.config.retryPolicy.maxRetries}`);
        } else {
            console.log(`[${this.serviceHostname}] Conn error. Retrying request. Attempt ${attempt + 1}/${this.config.retryPolicy.maxRetries}`);
        }
        
        const nextBackend = this.selectBackend(request);
        if (nextBackend && nextBackend.id !== backend.id) {
            return this.forwardRequest(request, nextBackend, attempt + 1);
        } else if (nextBackend && nextBackend.id === backend.id && this.config.backends.filter(b=>b.healthy || (Date.now()-(b.lastFailureTimestamp||0) > this.config.passiveHealthChecks.failureTimeoutMs)).length ===1 ) {
            console.warn(`[${this.serviceHostname}] Only one backend (${backend.id}) available, retrying on same after error.`);
            return this.forwardRequest(request, nextBackend, attempt + 1);
        } else if (!nextBackend) { console.warn(`[${this.serviceHostname}] No other backend to retry on after error.`); }
      } else if (isNonIdempotent && attempt < this.config.retryPolicy.maxRetries) {
        console.warn(`[${this.serviceHostname}] Not retrying ${request.method} request due to connection failure`);
      }
      
      return new Response(`Load Balancer: Backend server ${backend.url} is unavailable. ${errorType === 'Timeout' ? 'Request timed out.' : 'Connection error.'}`, { status: 503 });
    }
  }

  private async handleAdminRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(p => p); // e.g. ['__lb_admin__', 'config'] or ['__lb_metrics__', 'html']
    const command = pathParts[1];
    const subCommand = pathParts[2];

    if (command === "config" && request.method === "GET") {
      return new Response(JSON.stringify(this.config, null, 2), { headers: { "Content-Type": "application/json" } });
    }
    if (command === "config" && request.method === "POST") {
      try {
        const updates = await request.json<Partial<LoadBalancerServiceConfig>>();

        if (updates.backends) {
          const newBackends: Backend[] = [];
          updates.backends.forEach(updatedBackend => {
            if (!updatedBackend || !updatedBackend.id || !updatedBackend.url) {
              console.warn("Skipping invalid backend update entry: ", updatedBackend);
              return;
            }
            const existing = this.config.backends.find(b => b.id === updatedBackend!.id);
            if (existing) {
              newBackends.push({ ...existing, ...updatedBackend });
            } else {
              newBackends.push({
                id: updatedBackend.id,
                url: updatedBackend.url,
                weight: updatedBackend.weight ?? 1,
                healthy: updatedBackend.healthy ?? true,
                consecutiveFailures: updatedBackend.consecutiveFailures ?? 0,
                requests: 0, successfulRequests: 0, failedRequests: 0, totalResponseTimeMs: 0
              });
            }
          });
          this.config.backends = newBackends;
          // Re-init metrics for new/removed backends
          const currentBackendIdsInMetrics = new Set(Object.keys(this.metrics.backendMetrics));
          newBackends.forEach(b => {
            if (!currentBackendIdsInMetrics.has(b.id)) {
              this.metrics.backendMetrics[b.id] = { requests: 0, successfulRequests: 0, failedRequests: 0, totalResponseTimeMs: 0, avgResponseTimeMs: 0 };
            }
            currentBackendIdsInMetrics.delete(b.id);
          });
          currentBackendIdsInMetrics.forEach(removedBackendId => delete this.metrics.backendMetrics[removedBackendId]);
        }
        // Selectively update other config fields
        if (updates.sessionAffinity) this.config.sessionAffinity = { ...this.config.sessionAffinity, ...updates.sessionAffinity };
        if (updates.passiveHealthChecks) this.config.passiveHealthChecks = { ...this.config.passiveHealthChecks, ...updates.passiveHealthChecks };
        if (updates.activeHealthChecks) this.config.activeHealthChecks = { ...this.config.activeHealthChecks, ...updates.activeHealthChecks };
        if (updates.retryPolicy) this.config.retryPolicy = { ...this.config.retryPolicy, ...updates.retryPolicy };
        if (updates.hostHeaderRewrite) this.config.hostHeaderRewrite = updates.hostHeaderRewrite;
        if (updates.currentRoundRobinIndex !== undefined) this.config.currentRoundRobinIndex = updates.currentRoundRobinIndex;
        if (updates.observability) this.config.observability = { ...this.config.observability, ...updates.observability };

        await this.saveConfig();
        await this.saveMetrics();
        return new Response(JSON.stringify({ success: true, message: `Configuration for ${this.serviceHostname} updated.`, newConfig: this.config }), { headers: { "Content-Type": "application/json" } });
      } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
    }
    if (command === "metrics" && subCommand === "json" && request.method === "GET") {
      this.calculateAvgResponseTimes();
      return new Response(JSON.stringify(this.metrics, null, 2), { headers: { "Content-Type": "application/json" } });
    }
    if (command === "metrics" && subCommand === "html" && request.method === "GET") {
      return this.generateMetricsHtml();
    }

    return new Response("Admin/Metrics endpoint not found or method not allowed", { status: 404 });
  }

  private generateMetricsHtml(): Response {
    this.calculateAvgResponseTimes();
    let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Load Balancer Metrics: ${this.config.serviceId}</title>
            <style>
                body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif; margin: 20px; background-color: #f8f9fa; color: #212529; line-height: 1.6; }
                .container { max-width: 1200px; margin: auto; padding: 20px; }
                h1, h2 { color: #343a40; border-bottom: 2px solid #dee2e6; padding-bottom: 0.5em;}
                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; background-color: #fff; box-shadow: 0 2px 15px rgba(0,0,0,0.05); }
                th, td { border: 1px solid #dee2e6; padding: 12px 15px; text-align: left; vertical-align: top; }
                th { background-color: #e9ecef; font-weight: 600; }
                tr:nth-child(even) { background-color: #f8f9fa; }
                .healthy { color: #28a745; font-weight: bold; }
                .unhealthy { color: #dc3545; font-weight: bold; }
                .status-details { font-size: 0.85em; color: #6c757d; margin-top: 4px; display: block;}
                .config-section, .summary-section { background-color: #fff; padding: 20px; margin-bottom: 30px; box-shadow: 0 2px 15px rgba(0,0,0,0.05); border-radius: 8px; }
                pre { background-color: #e9ecef; padding: 15px; border: 1px solid #ced4da; border-radius: 5px; overflow-x: auto; font-size: 0.9em; }
                footer { text-align: center; margin-top: 40px; font-size: 0.9em; color: #6c757d; }
                .tag { display: inline-block; padding: .25em .4em; font-size: 75%; font-weight: 700; line-height: 1; text-align: center; white-space: nowrap; vertical-align: baseline; border-radius: .25rem; }
                .tag-healthy { color: #fff; background-color: #28a745; }
                .tag-unhealthy { color: #fff; background-color: #dc3545; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Load Balancer Metrics: ${this.config.serviceId}</h1>

                <div class="summary-section">
                    <h2>Overall Service Metrics</h2>
                    <p><strong>Total Requests Processed:</strong> ${this.metrics.totalRequests}</p>
                    <p><strong>Total Successful Requests:</strong> ${this.metrics.totalSuccessfulRequests}</p>
                    <p><strong>Total Failed Requests:</strong> ${this.metrics.totalFailedRequests}</p>
                </div>

                <h2>Backend Status & Metrics</h2>
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>URL</th>
                            <th>Weight</th>
                            <th>Status</th>
                            <th>Consec. Failures</th>
                            <th>Requests</th>
                            <th>Successful</th>
                            <th>Failed</th>
                            <th>Avg. Resp. Time (ms)</th>
                            <th>Last Failure</th>
                        </tr>
                    </thead>
                    <tbody>`;

    this.config.backends.forEach(backend => {
      const metrics = this.metrics.backendMetrics[backend.id] || { requests: 0, successfulRequests: 0, failedRequests: 0, totalResponseTimeMs: 0, avgResponseTimeMs: 0 };
      html += `
                <tr>
                    <td>${backend.id}</td>
                    <td><a href="${backend.url}" target="_blank">${backend.url}</a></td>
                    <td>${backend.weight}</td>
                    <td>
                        <span class="tag ${backend.healthy ? 'tag-healthy' : 'tag-unhealthy'}">${backend.healthy ? 'Healthy' : 'Unhealthy'}</span>
                        ${backend.status ? `<span class="status-details">Detail: ${backend.status}</span>` : ''}
                    </td>
                    <td>${backend.consecutiveFailures}</td>
                    <td>${metrics.requests}</td>
                    <td>${metrics.successfulRequests}</td>
                    <td>${metrics.failedRequests}</td>
                    <td>${metrics.avgResponseTimeMs.toFixed(2)}</td>
                    <td>${backend.lastFailureTimestamp ? new Date(backend.lastFailureTimestamp).toLocaleString() : 'N/A'}</td>
                </tr>`;
    });

    html += `
                    </tbody>
                </table>
                
                <div class="config-section">
                    <h2>Current Configuration</h2>
                    <pre>${JSON.stringify(this.config, null, 2)}</pre>
                </div>
                
                <footer>
                    <p>Metrics for service: <strong>${this.serviceHostname}</strong></p>
                    <p>Generated at: ${new Date().toLocaleString()}</p>
                </footer>
            </div>
        </body>
        </html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-f" } });
  }

  async handleRequest(request: Request): Promise<Response> {
    if (!this.initialized) {
      console.log(`[${this.serviceHostname}] Handling request before initialization. Loading state.`);
      await this.loadState();
    }

    console.log(`[${this.serviceHostname}] Handling ${request.method} ${request.url} for service: ${this.config.serviceId}`);

    // Check if service has any backends configured
    if (!this.config.backends || this.config.backends.length === 0) {
      console.log(`[${this.serviceHostname}] No backends configured for service ${this.config.serviceId}. Request cannot be processed.`);
      return new Response(
        JSON.stringify({
          error: "Service Not Configured",
          message: `No backends are configured for service ${this.config.serviceId}. Please configure backends via the API.`,
          serviceId: this.config.serviceId
        }),
        { 
          status: 503, 
          headers: { 
            "content-type": "application/json",
            "X-CF-Service-Id": this.config.serviceId 
          } 
        }
      );
    }

    // Check for healthy backends
    const healthyBackends = this.config.backends.filter(b => b.healthy);
    if (healthyBackends.length === 0) {
      console.log(`[${this.serviceHostname}] No healthy backends available for service ${this.config.serviceId}`);
      return new Response(
        JSON.stringify({
          error: "No Healthy Backends",
          message: `All backends for service ${this.config.serviceId} are currently unhealthy.`,
          serviceId: this.config.serviceId
        }),
        { 
          status: 503, 
          headers: { 
            "content-type": "application/json",
            "X-CF-Service-Id": this.config.serviceId 
          } 
        }
      );
    }

    // Select a backend for this request
    const backend = this.selectBackend(request);
    if (!backend) {
      console.log(`[${this.serviceHostname}] Failed to select a backend for request`);
      return new Response(
        JSON.stringify({
          error: "Backend Selection Failed",
          message: "Failed to select a backend for this request.",
          serviceId: this.config.serviceId
        }),
        { 
          status: 503, 
          headers: { 
            "content-type": "application/json",
            "X-CF-Service-Id": this.config.serviceId 
          } 
        }
      );
    }

    // Forward the request
    return this.forwardRequest(request, backend);
  }

  async alarm() {
    console.log(`Durable Object Alarm triggered for ${this.serviceHostname} at ${new Date().toISOString()}`);
    if (!this.config) {
      console.warn(`Alarm for ${this.serviceHostname}: Config not loaded, cannot perform active health checks.`);
      await this.loadState(); // Try to load state again
      if (!this.config) return; // Still no config, exit
    }

    if (this.config?.activeHealthChecks?.enabled) {
      console.log(`[${this.serviceHostname}] Alarm: Performing active health checks...`);
      let configChanged = false;
      for (const backend of this.config.backends) {
        try {
          const healthUrl = new URL(this.config.activeHealthChecks.path, backend.url); // Correctly join path with backend base URL

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.config.activeHealthChecks!.timeoutMs);

          const response = await fetch(healthUrl.toString(), { signal: controller.signal, method: 'GET', cf: { apps: false } });
          clearTimeout(timeoutId);

          const expectedStatus = this.config.activeHealthChecks.expectedStatusCode || 200;
          let currentBackendStatus = `Active Check: ${response.status}`;

          if (response.status === expectedStatus) {
            if (this.config.activeHealthChecks.expectedResponseBody) {
              const bodyText = await response.text();
              if (!bodyText.includes(this.config.activeHealthChecks.expectedResponseBody)) {
                if (backend.healthy) { // Transition to unhealthy
                  console.warn(`[${this.serviceHostname}] Active HC FAIL: Backend ${backend.id} (${backend.url}) status ${response.status} but body mismatch.`);
                  backend.healthy = false;
                  backend.consecutiveFailures = (backend.consecutiveFailures || 0) + 1;
                  backend.lastFailureTimestamp = Date.now();
                  configChanged = true;
                }
                currentBackendStatus += ' (Body Mismatch)';
              } else {
                if (!backend.healthy || backend.consecutiveFailures > 0) {
                  console.log(`[${this.serviceHostname}] Active HC OK: Backend ${backend.id} (${backend.url}) is healthy.`);
                  backend.healthy = true;
                  backend.consecutiveFailures = 0;
                  configChanged = true;
                }
              }
            } else {
              if (!backend.healthy || backend.consecutiveFailures > 0) {
                console.log(`[${this.serviceHostname}] Active HC OK: Backend ${backend.id} (${backend.url}) is healthy.`);
                backend.healthy = true;
                backend.consecutiveFailures = 0;
                configChanged = true;
              }
            }
          } else { // Status mismatch
            if (backend.healthy) {
              console.warn(`[${this.serviceHostname}] Active HC FAIL: Backend ${backend.id} (${backend.url}) failed with status ${response.status}. Expected ${expectedStatus}.`);
              backend.healthy = false;
              backend.consecutiveFailures = (backend.consecutiveFailures || 0) + 1;
              backend.lastFailureTimestamp = Date.now();
              configChanged = true;
            }
          }
          backend.status = currentBackendStatus;
        } catch (error: any) {
          if (backend.healthy) {
            console.warn(`[${this.serviceHostname}] Active HC FAIL: Backend ${backend.id} (${backend.url}) fetch error: ${error.message}`);
            backend.healthy = false;
            backend.consecutiveFailures = (backend.consecutiveFailures || 0) + 1;
            backend.lastFailureTimestamp = Date.now();
            configChanged = true;
          }
          backend.status = `Active Check Error: ${error.message.substring(0, 30)}`;
        }
      }
      if (configChanged) await this.saveConfig();
    }

    if (this.config?.activeHealthChecks?.enabled && this.config.activeHealthChecks.intervalMs > 0) {
      console.log(`[${this.serviceHostname}] Alarm: Rescheduling alarm for ${this.config.activeHealthChecks.intervalMs}ms.`);
      this.state.storage.setAlarm(Date.now() + this.config.activeHealthChecks.intervalMs);
    } else {
      console.log(`[${this.serviceHostname}] Alarm: Active health checks disabled or interval not set. Not rescheduling.`);
    }
  }
}
