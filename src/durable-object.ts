import {
  LoadBalancerServiceConfig,
  StoredState,
  Backend,
  UpdateServiceConfigRequest,
  ServiceMetrics,
  OriginPool,
  LoadBalancer,
  CreateLoadBalancerRequest,
  ConfigurationUpdateRequest,
  LogEntry
} from "./types";
import { LoadBalancerEngine } from "./load-balancer-engine";

export class LoadBalancerDO implements DurableObject {
  state: DurableObjectState;
  env: Env;
  config!: LoadBalancerServiceConfig; // Loaded in constructor
  metrics!: ServiceMetrics; // Initialized in constructor
  initialized: boolean = false;
  serviceHostname: string; // The hostname this DO instance is responsible for
  debug: boolean;
  private requestCountSinceSave: number = 0;
  private saveThreshold: number = 100;
  private loadBalancerEngine?: LoadBalancerEngine;
  private logEntries: LogEntry[] = [];
  private maxLogEntries: number = 1000;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.debug = env.DEBUG === 'true';
    this.serviceHostname = state.id.name || "default-service";

    this.state.blockConcurrencyWhile(async () => {
      try {
        await this.loadState();
        // Initialize the load balancer engine
        this.loadBalancerEngine = new LoadBalancerEngine(this.config);
        // Set the environment for bindings (email, KV, etc.)
        this.loadBalancerEngine.setEnvironment(this.env);
        
        // Log successful initialization
        this.addLogEntry('info', `Load balancer initialized for service ${this.serviceHostname}`, 'system', {
          mode: this.config.mode,
          pools: this.config.pools.length,
          backends: this.config.pools.reduce((count, pool) => count + pool.backends.length, 0)
        });
        // Ensure an alarm is set if active health checks are enabled
        if (this.config?.activeHealthChecks?.enabled && this.config.activeHealthChecks.interval > 0) {
          const currentAlarm = await this.state.storage.getAlarm();
          if (currentAlarm == null) {
            console.log(`[${this.serviceHostname}] Setting initial alarm for active health checks.`);
            await this.state.storage.setAlarm(Date.now() + (this.config.activeHealthChecks.interval * 1000));
          }
        }
      } catch (error) {
        console.error(`[${this.serviceHostname}] Error during initialization:`, error);
        // Initialize with empty config if loading fails
        await this.initializeEmptyConfig(this.serviceHostname);
        // Re-initialize the load balancer engine with the empty config
        this.loadBalancerEngine = new LoadBalancerEngine(this.config);
        this.loadBalancerEngine.setEnvironment(this.env);
      }
    });
  }

  private async initializeEmptyConfig(serviceId: string) {
    // Check if we have DEFAULT_BACKENDS for this service using JSON parsing
    let serviceBackends: string[] | undefined;
    
    if (this.env.DEFAULT_BACKENDS) {
      try {
        const config = JSON.parse(this.env.DEFAULT_BACKENDS);
        
        // Support both array format and object format
        let services: any[] = [];
        if (Array.isArray(config)) {
          services = config;
        } else if (config.services && Array.isArray(config.services)) {
          services = config.services;
        } else if (config.hostname && Array.isArray(config.backends)) {
          services = [config];
        }
        
        const matchingService = services.find((service: any) => service.hostname === serviceId);
        if (matchingService && Array.isArray(matchingService.backends)) {
          serviceBackends = matchingService.backends;
        }
      } catch (error) {
        console.error(`[${serviceId}] Failed to parse DEFAULT_BACKENDS JSON:`, error);
      }
    }
    
    if (this.debug) {
      console.log(`[${serviceId}] DEFAULT_BACKENDS:`, this.env.DEFAULT_BACKENDS);
      console.log(`[${serviceId}] Found serviceBackends:`, serviceBackends);
    }
    
    if (serviceBackends && serviceBackends.length > 0) {
      // Simple mode with default backends
      if (this.debug) {
        console.log(`[${serviceId}] Parsed URLs:`, serviceBackends);
      }
      this.config = {
        serviceId,
        mode: 'simple',
        simpleBackends: serviceBackends,
        pools: [{
          id: "simple-pool",
          name: "Simple Failover Pool",
          backends: serviceBackends.map((url: string, index: number) => ({
            id: `backend-${index}`,
            url: url,
            ip: new URL(url).hostname,
            weight: 1,
            healthy: true,
            consecutiveFailures: 0,
            requests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalResponseTimeMs: 0,
            priority: 10,
            enabled: true
          })),
          enabled: true,
          minimum_origins: 1,
          endpoint_steering: 'round_robin'
        }],
        load_balancer: {
          id: "simple-lb",
          name: "Simple Load Balancer",
          hostname: serviceId,
          default_pool_ids: ["simple-pool"],
          proxied: true,
          enabled: true,
          steering_policy: "off",
          session_affinity: {
            type: "none",
            enabled: false
          },
          // NEW: Zero-downtime failover configuration
          zero_downtime_failover: {
            enabled: true,
            policy: 'temporary',
            trigger_codes: [521, 522, 523, 525, 526],
            max_retries: 3,
            retry_delay_ms: 500,
            adaptive_routing: true
          }
        },
        currentRoundRobinIndex: 0,
        passiveHealthChecks: { 
          max_failures: 3, 
          failure_timeout_ms: 30000, 
          retryable_status_codes: [500, 502, 503, 504, 521, 522, 523, 525, 526], 
          enabled: true, 
          monitor_timeout: 10,
          // NEW: Enhanced error handling configuration
          circuit_breaker: {
            enabled: true,
            failure_threshold: 5,
            recovery_timeout_ms: 60000,
            success_threshold: 3,
            error_rate_threshold: 50,
            min_requests: 10
          },
          connection_error_handling: {
            immediate_failover: true,
            max_connection_retries: 2,
            connection_timeout_ms: 10000,
            retry_backoff_ms: 1000
          },
          health_scoring: {
            enabled: true,
            response_time_weight: 0.3,
            error_rate_weight: 0.4,
            availability_weight: 0.3,
            time_window_ms: 300000
          }
        },
        activeHealthChecks: { 
          enabled: false, 
          path: "/health", 
          interval: 60, 
          timeout: 5, 
          type: 'http', 
          consecutive_up: 2, 
          consecutive_down: 3, 
          retries: 1 
        },
        retryPolicy: { 
          max_retries: 2, 
          retry_timeout: 10000, 
          backoff_strategy: 'constant', 
          base_delay: 1000 
        },
        hostHeaderRewrite: 'preserve',
        observability: { 
          responseHeaderName: "X-Backend-Used",
          add_backend_header: true 
        }
      };
    } else {
      // Advanced mode - empty configuration
      this.config = {
        serviceId,
        mode: 'advanced',
        pools: [
          {
            id: "default-pool",
            name: "Default Pool",
            backends: [
              {
                id: "default-backend",
                url: "https://example.com",
                ip: "192.0.2.1",
                weight: 1,
                healthy: true,
                consecutiveFailures: 0,
                requests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                totalResponseTimeMs: 0,
                priority: 10,
                enabled: true
              }
            ],
            enabled: true,
            minimum_origins: 1,
            endpoint_steering: 'round_robin'
          }
        ],
        load_balancer: {
          id: "default-lb",
          name: "Default Load Balancer",
          hostname: serviceId,
          default_pool_ids: ["default-pool"],
          proxied: true,
          enabled: true,
          steering_policy: "off",
          session_affinity: {
            type: "none",
            enabled: false
          },
          zero_downtime_failover: {
            enabled: true,
            policy: 'temporary',
            trigger_codes: [521, 522, 523, 525, 526],
            max_retries: 3,
            retry_delay_ms: 500,
            adaptive_routing: true
          }
        },
        currentRoundRobinIndex: 0,
        passiveHealthChecks: { 
          max_failures: 3, 
          failure_timeout_ms: 30000, 
          retryable_status_codes: [500, 502, 503, 504, 521, 522, 523, 525, 526], 
          enabled: true, 
          monitor_timeout: 10,
          circuit_breaker: {
            enabled: true,
            failure_threshold: 5,
            recovery_timeout_ms: 60000,
            success_threshold: 3,
            error_rate_threshold: 50,
            min_requests: 10
          },
          connection_error_handling: {
            immediate_failover: true,
            max_connection_retries: 2,
            connection_timeout_ms: 10000,
            retry_backoff_ms: 1000
          },
          health_scoring: {
            enabled: true,
            response_time_weight: 0.3,
            error_rate_weight: 0.4,
            availability_weight: 0.3,
            time_window_ms: 300000
          }
        },
        activeHealthChecks: { enabled: false, path: "/healthz", interval: 60, timeout: 5, type: 'http', consecutive_up: 2, consecutive_down: 3, retries: 1 },
        retryPolicy: { max_retries: 1, retry_timeout: 10000, backoff_strategy: 'constant', base_delay: 1000 },
        hostHeaderRewrite: 'preserve',
        observability: { responseHeaderName: "X-CF-Backend-Used" }
      };
    }
    await this.saveConfig();
  }

  private async loadState() {
    try {
      const stored = await this.state.storage.get<StoredState>("state");
      if (stored && stored.config) {
        this.config = stored.config;
        // Ensure serviceId always matches the hostname
        this.config.serviceId = this.serviceHostname;
        
        // Ensure pools array exists
        if (!this.config.pools) {
          this.config.pools = [];
        }
        
        this.config.pools.forEach(pool => {
          if (pool.backends) {
            pool.backends.forEach(b => { // Ensure metric fields exist if loaded from older state
              b.requests = b.requests ?? 0;
              b.successfulRequests = b.successfulRequests ?? 0;
              b.failedRequests = b.failedRequests ?? 0;
              b.totalResponseTimeMs = b.totalResponseTimeMs ?? 0;
            });
          }
        });
        
        if (this.debug) {
          console.log(`[${this.serviceHostname}] Config loaded from storage:`, {
            mode: this.config.mode,
            simpleBackends: this.config.simpleBackends,
            poolCount: this.config.pools.length,
            backendCount: this.config.pools.reduce((count, pool) => count + pool.backends.length, 0)
          });
        }
      } else {
        if (this.debug) {
          console.log(`[${this.serviceHostname}] No stored config found, initializing empty config`);
        }
        await this.initializeEmptyConfig(this.serviceHostname);
      }

      this.metrics = await this.state.storage.get<ServiceMetrics>("metrics") || {
        serviceId: this.config.serviceId,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0,
        backendMetrics: {},
        poolMetrics: {}
      };
      
      // Ensure metrics serviceId always matches the hostname
      this.metrics.serviceId = this.serviceHostname;

      let runningTotalRequests = 0, runningTotalSuccess = 0, runningTotalFailed = 0;
      if (this.config.pools) {
        this.config.pools.forEach(pool => {
          if (pool.backends) {
            pool.backends.forEach((b: Backend) => {
              if (!this.metrics.backendMetrics[b.id]) {
                this.metrics.backendMetrics[b.id] = {
                  requests: b.requests || 0, successfulRequests: b.successfulRequests || 0,
                  failedRequests: b.failedRequests || 0, totalResponseTimeMs: b.totalResponseTimeMs || 0,
                  avgResponseTimeMs: 0,
                };
              }
              runningTotalRequests += this.metrics.backendMetrics[b.id].requests;
              runningTotalSuccess += this.metrics.backendMetrics[b.id].successfulRequests;
              runningTotalFailed += this.metrics.backendMetrics[b.id].failedRequests;
            });
          }
        });
      }
      this.metrics.totalRequests = Math.max(this.metrics.totalRequests, runningTotalRequests);
      this.metrics.totalSuccessfulRequests = Math.max(this.metrics.totalSuccessfulRequests, runningTotalSuccess);
      this.metrics.totalFailedRequests = Math.max(this.metrics.totalFailedRequests, runningTotalFailed);

      this.calculateAvgResponseTimes();
      this.initialized = true;
      console.log(`[${this.serviceHostname}] DO Initialized. Config loaded for serviceId: ${this.config.serviceId}. Backends: ${this.config.pools.reduce((count, pool) => count + pool.backends.length, 0)}`);
    } catch (error) {
      console.error(`[${this.serviceHostname}] Error loading state:`, error);
      // Initialize with empty config if loading fails
      await this.initializeEmptyConfig(this.serviceHostname);
      this.metrics = {
        serviceId: this.serviceHostname,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0,
        backendMetrics: {},
        poolMetrics: {}
      };
      this.initialized = true;
    }
  }

  private async saveConfig() {
    if (!this.config) return;
    const stateToStore: StoredState = { config: this.config };
    await this.state.storage.put("state", stateToStore);
    
    if (this.debug) {
      console.log(`[${this.serviceHostname}] Config saved:`, {
        mode: this.config.mode,
        simpleBackends: this.config.simpleBackends,
        poolCount: this.config.pools.length,
        backendCount: this.config.pools.reduce((count, pool) => count + pool.backends.length, 0)
      });
    }
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
      const backendExistsInConfig = this.findBackendInPools(backendId);
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

    const backendInConfig = this.findBackendInPools(backendId);
    if (backendInConfig) {
      backendInConfig.requests = backendMetric.requests;
      backendInConfig.successfulRequests = backendMetric.successfulRequests;
      backendInConfig.failedRequests = backendMetric.failedRequests;
      backendInConfig.totalResponseTimeMs = backendMetric.totalResponseTimeMs;
    }
    // Batch metrics and config saves every saveThreshold requests
    this.requestCountSinceSave++;
    if (this.requestCountSinceSave >= this.saveThreshold) {
      this.state.waitUntil(this.saveMetrics());
      this.state.waitUntil(this.saveConfig());
      this.requestCountSinceSave = 0;
    }
  }

  private findBackendInPools(backendId: string): Backend | undefined {
    if (!this.config.pools) return undefined;
    
    for (const pool of this.config.pools) {
      if (pool.backends) {
        const backend = pool.backends.find(b => b.id === backendId);
        if (backend) return backend;
      }
    }
    return undefined;
  }

  private getClientIp(request: Request): string | null {
    return request.headers.get("CF-Connecting-IP");
  }

  private selectBackend(request: Request): Backend | null {
    if (!this.config || !this.config.pools.length) {
      console.warn(`[${this.serviceHostname}] SelectBackend: No pools configured.`);
      return null;
    }

    const sessionAffinity = this.config.load_balancer.session_affinity;
    
    // Get all healthy backends from all pools
    let configChangedDueToHealthRevival = false;
    const healthyBackends: Backend[] = [];
    this.config.pools.forEach(pool => {
      pool.backends.forEach((b: Backend) => {
        if (b.healthy) {
          healthyBackends.push(b);
        } else if (Date.now() - (b.lastFailureTimestamp || 0) > this.config.passiveHealthChecks.failure_timeout_ms) {
          console.log(`[${this.serviceHostname}] Select: Backend ${b.id} failure timeout expired. Marking as healthy.`);
          b.healthy = true; 
          b.consecutiveFailures = 0; 
          configChangedDueToHealthRevival = true;
          healthyBackends.push(b);
        }
      });
    });

    if (healthyBackends.length === 0) {
      if (configChangedDueToHealthRevival) this.state.waitUntil(this.saveConfig()); // Save revivals before returning null
      console.warn(`[${this.serviceHostname}] SelectBackend: No healthy backends remain after filtering.`);
      return null;
    }
    
    // 1. Session Affinity Check - Only use if enabled, healthy backends available, and respecting weights
    if (sessionAffinity && sessionAffinity.type !== 'none' && sessionAffinity.enabled) {
      let stickyBackendId: string | null = null;
      
      if (sessionAffinity.type === 'cookie' && sessionAffinity.cookieName) {
        const cookieHeader = request.headers.get("Cookie");
        if (cookieHeader) {
          const cookies = cookieHeader.split(';');
          for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === sessionAffinity.cookieName) {
              stickyBackendId = value;
              break;
            }
          }
        }
      } else if (sessionAffinity.type === 'ip_cookie') {
        const clientIp = this.getClientIp(request);
        if (clientIp) {
          // Hash the client IP to get a consistent value
          let hash = 0;
          for (let i = 0; i < clientIp.length; i++) { 
            hash = ((hash << 5) - hash) + clientIp.charCodeAt(i); 
            hash |= 0; 
          }
          
          // Use weighted selection based on the client IP hash
          // This ensures consistent backend selection for the same client
          // while still respecting backend weights
          
          // Calculate total weight
          const totalWeight = healthyBackends.reduce((sum, b) => sum + b.weight, 0);
          
          // Use the hash to get a consistent position in the weight range
          const position = Math.abs(hash) % totalWeight;
          let currentWeight = 0;
          
          for (const backend of healthyBackends) {
            currentWeight += backend.weight;
            if (position < currentWeight) {
              stickyBackendId = backend.id;
              break;
            }
          }
          
          // If somehow we didn't select a backend (shouldn't happen), use the first one
          if (!stickyBackendId && healthyBackends.length > 0) {
            stickyBackendId = healthyBackends[0].id;
          }
        }
      }

      if (stickyBackendId) {
        const stickyBackend = this.findBackendInPools(stickyBackendId);
        // Only use sticky backend if it's actually healthy
        if (stickyBackend && stickyBackend.healthy) {
          console.log(`[${this.serviceHostname}] Affinity: Using healthy backend ${stickyBackend.id} with weight ${stickyBackend.weight}`);
          
          if (configChangedDueToHealthRevival) this.state.waitUntil(this.saveConfig());
          return stickyBackend;
        } else if (stickyBackend && !stickyBackend.healthy) {
          console.log(`[${this.serviceHostname}] Affinity: Sticky backend ${stickyBackend.id} is unhealthy, falling back to weighted selection`);
        }
      }
    }
    
    // Implement Smooth Weighted Round-Robin algorithm for optimal distribution
    const hasWeights = healthyBackends.some(b => b.weight !== 1);
    let selected: Backend;

    if (hasWeights) {
      // Smooth Weighted Round-Robin (SWRR) algorithm
      // This provides better distribution than simple weighted round-robin
      // Initialize current weights if not present
      if (!this.config.backendCurrentWeights) {
        this.config.backendCurrentWeights = {};
      }
      
      // Calculate total weight
      const totalWeight = healthyBackends.reduce((sum, b) => sum + b.weight, 0);
      
      // Update current weights and find the backend with highest current weight
      let maxCurrentWeight = -1;
      selected = healthyBackends[0]; // fallback
      
      for (const backend of healthyBackends) {
        // Initialize current weight if not present
        if (this.config.backendCurrentWeights[backend.id] === undefined) {
          this.config.backendCurrentWeights[backend.id] = 0;
        }
        
        // Add the backend's weight to its current weight
        this.config.backendCurrentWeights[backend.id] += backend.weight;
        
        // Track the backend with the highest current weight
        if (this.config.backendCurrentWeights[backend.id] > maxCurrentWeight) {
          maxCurrentWeight = this.config.backendCurrentWeights[backend.id];
          selected = backend;
        }
      }
      
      // Reduce the selected backend's current weight by the total weight
      this.config.backendCurrentWeights[selected.id] -= totalWeight;
      
      // Clean up weights for backends that are no longer healthy
      const healthyBackendIds = new Set(healthyBackends.map(b => b.id));
      for (const backendId in this.config.backendCurrentWeights) {
        if (!healthyBackendIds.has(backendId)) {
          delete this.config.backendCurrentWeights[backendId];
        }
      }
    } else {
      // Simple round-robin when all weights are equal
      this.config.currentRoundRobinIndex = (this.config.currentRoundRobinIndex + 1) % healthyBackends.length;
      selected = healthyBackends[this.config.currentRoundRobinIndex];
    }

    if (configChangedDueToHealthRevival) this.state.waitUntil(this.saveConfig()); // Save index and any revived health status
    else this.state.waitUntil(this.state.storage.put("state.currentRoundRobinIndex", this.config.currentRoundRobinIndex)); // Optimization: save only index if no health changes

    return selected;
  }

  private async forwardRequest(request: Request, backend: Backend, attempt: number = 0): Promise<Response> {
    const requestStartTime = Date.now();
    
    // Clone the request to modify it
    const url = new URL(request.url);
    const backendUrl = new URL(backend.url);
    
    // Apply backend hostname but keep original path
    const forwardUrl = new URL(url.pathname + url.search, backend.url);
    
    // Prepare request headers
    const headers = new Headers(request.headers);
    
    // Apply Host header rewrite if configured
    if (this.config.hostHeaderRewrite === 'backend_hostname') {
      headers.set('Host', backendUrl.host);
    } else if (this.config.hostHeaderRewrite !== 'preserve' && typeof this.config.hostHeaderRewrite === 'string') {
      headers.set('Host', this.config.hostHeaderRewrite);
    }
    
    // Add custom headers
    headers.set('X-Forwarded-For', this.getClientIp(request) || '');
    headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
    headers.set('X-Forwarded-Host', url.host);
    
    // Construct the new request
    const newRequest = new Request(forwardUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual' // Don't follow redirects automatically
    });
    
    try {
      // Apply enhanced timeout based on configuration
      const controller = new AbortController();
      const timeoutMs = this.config.passiveHealthChecks.connection_error_handling?.connection_timeout_ms || 30000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      
      const isNonIdempotent = ['POST', 'PUT', 'PATCH'].includes(request.method);
      
      // Forward the request
      const response = await fetch(newRequest, { signal: controller.signal });
      clearTimeout(timeout);
      
      const responseTime = Date.now() - requestStartTime;
      
      // Record metrics for this request
      this.recordMetric(backend.id, response.ok && response.status < 400, responseTime);
      
      // Check if this is a successful response
      if (response.ok || (response.status < 500 && !this.config.passiveHealthChecks.retryable_status_codes.includes(response.status))) {
        // Handle successful response using load balancer engine
        if (this.loadBalancerEngine) {
          this.loadBalancerEngine.handleBackendSuccess(backend, responseTime);
        } else {
          // Fallback to original logic
          if (backend.consecutiveFailures > 0 || !backend.healthy) {
            console.log(`[${this.serviceHostname}] Backend ${backend.id} healthy again after success.`);
            backend.consecutiveFailures = 0; 
            backend.healthy = true; 
            backend.status = "Healthy";
            this.state.waitUntil(this.saveConfig());
          }
        }
        
        // Prepare response headers
        const newHeaders = new Headers(response.headers);
        
        // Add debugging headers if configured
        if (this.config.observability.add_backend_header) {
          newHeaders.set('X-Backend-Used', backend.id);
        }
        
        // Log successful request
        this.addLogEntry('info', `Request forwarded successfully to backend ${backend.id}`, 'request', {
          backendId: backend.id,
          statusCode: response.status,
          responseTime: responseTime,
          clientIp: this.getClientIp(request) || undefined,
          method: request.method,
          path: url.pathname
        });
        
        // Handle session affinity - set cookie for future requests if enabled
        const sessionAffinity = this.config.load_balancer.session_affinity;
        if (sessionAffinity && sessionAffinity.enabled && sessionAffinity.type === 'cookie' && sessionAffinity.cookieName) {
          // Add or update the session cookie with the backend ID
          const cookieValue = backend.id;
          const cookieTtl = sessionAffinity.ttl || 86400; // Default to 24 hours
          const sameSite = 'lax';
          const secure = true;
          
          newHeaders.set('Set-Cookie', 
            `${sessionAffinity.cookieName}=${cookieValue}; Path=/; Max-Age=${cookieTtl}; SameSite=${sameSite}; ${secure ? 'Secure;' : ''}`);
            
          if (this.debug) {
            console.log(`[${this.serviceHostname}] Setting session affinity cookie: ${sessionAffinity.cookieName}=${cookieValue}`);
          }
        }
        
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      } else {
        // Handle error response using load balancer engine
        if (this.loadBalancerEngine) {
          this.loadBalancerEngine.handleBackendError(backend, response, responseTime);
        } else {
          // Fallback to original logic
          backend.consecutiveFailures++; 
          backend.lastFailureTimestamp = Date.now(); 
          backend.status = `Failed (status ${response.status})`;
          console.warn(`[${this.serviceHostname}] Backend ${backend.id} fail status ${response.status}. Consecutive: ${backend.consecutiveFailures}`);
          if (backend.consecutiveFailures >= this.config.passiveHealthChecks.max_failures) {
            backend.healthy = false; 
            backend.status = `Unhealthy (status ${response.status}, ${backend.consecutiveFailures} fails)`;
            console.error(`[${this.serviceHostname}] Backend ${backend.id} marked unhealthy.`);
            this.state.waitUntil(this.saveConfig());
          }
        }
        
        // Log error response
        this.addLogEntry('warn', `Backend ${backend.id} returned error status ${response.status}`, 'request', {
          backendId: backend.id,
          statusCode: response.status,
          responseTime: responseTime,
          clientIp: this.getClientIp(request) || undefined,
          method: request.method,
          path: url.pathname,
          consecutiveFailures: backend.consecutiveFailures
        });
        
        // Check if this is a zero-downtime failover trigger code (523, 522, etc.)
        const zeroDowntimeConfig = this.config.load_balancer.zero_downtime_failover;
        const isZeroDowntimeTrigger = zeroDowntimeConfig?.enabled && 
          zeroDowntimeConfig.trigger_codes?.includes(response.status);
        
        // Enhanced retry logic for 523 and other connection errors
        const maxRetries = isZeroDowntimeTrigger ? 
          (zeroDowntimeConfig.max_retries || 3) : 
          this.config.retryPolicy.max_retries;
          
        const shouldRetry = attempt < maxRetries && (
          isZeroDowntimeTrigger || // Always retry zero-downtime failover triggers
          this.config.passiveHealthChecks.retryable_status_codes.includes(response.status) &&
          (!isNonIdempotent || response.status >= 502) // Only retry non-idempotent on server errors (502+)
        );
        
        if (shouldRetry) {
          const retryDelay = isZeroDowntimeTrigger ? 
            (zeroDowntimeConfig.retry_delay_ms || 500) : 
            this.config.retryPolicy.base_delay;
            
          console.log(`[${this.serviceHostname}] Retrying request due to ${response.status} error. Attempt ${attempt + 1}/${maxRetries}`);
          
          // Add retry delay for zero-downtime failover
          if (retryDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
          
          // Try to get a different backend for retry
          const nextBackend = this.selectBackend(request);
          if (nextBackend && nextBackend.id !== backend.id) {
            return this.forwardRequest(request, nextBackend, attempt + 1);
          } else if (nextBackend && nextBackend.id === backend.id) {
            // Only one backend available - still retry if it's a critical error like 523
            if (isZeroDowntimeTrigger || response.status === 523) {
              console.warn(`[${this.serviceHostname}] Only one backend (${backend.id}) available, retrying same for critical error ${response.status}.`);
              return this.forwardRequest(request, nextBackend, attempt + 1);
            }
          }
        }
        
        // Return the error response (no more retries)
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    } catch (error) {
      // Handle connection errors (network errors, timeouts, etc.)
      const errorType = error instanceof DOMException && error.name === 'AbortError' ? 'Timeout' : 'Connection';
      const responseTime = Date.now() - requestStartTime;
      
      console.error(`[${this.serviceHostname}] ${errorType} error for ${backend.id}: ${error}`);
      
      // Log connection error
      this.addLogEntry('error', `${errorType} error for backend ${backend.id}`, 'error', {
        backendId: backend.id,
        errorType: errorType,
        responseTime: responseTime,
        clientIp: this.getClientIp(request) || undefined,
        method: request.method,
        path: url.pathname,
        consecutiveFailures: backend.consecutiveFailures,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Record the failure
      this.recordMetric(backend.id, false, responseTime);
      
      // Handle error using load balancer engine
      if (this.loadBalancerEngine) {
        this.loadBalancerEngine.handleBackendError(backend, error as Error, responseTime);
      } else {
        // Fallback to original logic
        backend.consecutiveFailures++; 
        backend.lastFailureTimestamp = Date.now(); 
        backend.status = `Error (${errorType})`;
        if (backend.consecutiveFailures >= this.config.passiveHealthChecks.max_failures) {
          backend.healthy = false; 
          backend.status = `Unhealthy (${errorType}, ${backend.consecutiveFailures} fails)`;
          console.error(`[${this.serviceHostname}] Backend ${backend.id} marked unhealthy due to fetch error.`);
          this.state.waitUntil(this.saveConfig());
        }
      }
      
      // Enhanced retry logic for connection errors
      const connectionConfig = this.config.passiveHealthChecks.connection_error_handling;
      const shouldImmediatelyFailover = connectionConfig?.immediate_failover && errorType === 'Connection';
      const maxRetries = shouldImmediatelyFailover ? 
        (connectionConfig.max_connection_retries || 2) : 
        this.config.retryPolicy.max_retries;
      
      const isNonIdempotent = ['POST', 'PUT', 'PATCH'].includes(request.method);
      const shouldRetry = attempt < maxRetries && (
        shouldImmediatelyFailover || // Immediate failover for connection errors
        (!isNonIdempotent || errorType === 'Timeout') // Retry non-idempotent only on timeout
      );
      
      if (shouldRetry) {
        const retryDelay = shouldImmediatelyFailover ? 
          (connectionConfig?.retry_backoff_ms || 1000) : 
          this.config.retryPolicy.base_delay;
          
        console.log(`[${this.serviceHostname}] Retrying request after ${errorType} error. Attempt ${attempt + 1}/${maxRetries}`);
        
        // Add retry backoff
        if (retryDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
        
        const nextBackend = this.selectBackend(request);
        if (nextBackend && nextBackend.id !== backend.id) {
          return this.forwardRequest(request, nextBackend, attempt + 1);
        } else if (nextBackend && nextBackend.id === backend.id && shouldImmediatelyFailover) {
          // For connection errors, still retry the same backend once more
          console.warn(`[${this.serviceHostname}] Only one backend (${backend.id}) available, retrying after ${errorType} error.`);
          return this.forwardRequest(request, nextBackend, attempt + 1);
        }
      }
      
      // If no retry or all retries failed, throw a more specific error
      throw new Error(`${errorType} error connecting to backend ${backend.id} (attempt ${attempt + 1}): ${error}`);
    }
  }

  private async handleAdminRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    
    if (pathParts.length < 2 || pathParts[0] !== '__lb_admin__') {
      return new Response('Invalid admin path', { status: 400 });
    }

    const operation = pathParts[1];

    switch (operation) {
      case 'backends':
        return this.handleBackendsRequest(request);
      
      case 'health':
        return this.handleHealthRequest();
      
      case 'metrics':
        return this.generateMetricsHtml();
      
      case 'config':
        return this.handleConfigRequest(request);
      
      case 'initialize':
        return this.handleInitializeRequest(request);
      
      case 'logs':
        if (request.method === 'DELETE') {
          return this.handleClearLogsRequest();
        }
        return this.handleLogsRequest(request);
      
      case 'health-metrics':
        return this.handleHealthMetricsRequest();
      
      default:
        return new Response('Unknown operation', { status: 404 });
    }
  }

  private async handleBackendsRequest(request: Request): Promise<Response> {
    const method = request.method;

    switch (method) {
      case 'GET':
        // Return all backends across all pools
        const allBackends = this.config.pools.flatMap(pool => 
          pool.backends.map(backend => ({
            ...backend,
            poolId: pool.id,
            poolName: pool.name,
            metrics: this.metrics.backendMetrics[backend.id] || {
              requests: 0,
              successfulRequests: 0,
              failedRequests: 0,
              totalResponseTimeMs: 0,
              avgResponseTimeMs: 0
            }
          }))
        );

        return new Response(JSON.stringify({
          backends: allBackends,
          totalBackends: allBackends.length,
          healthyBackends: allBackends.filter(b => b.healthy).length,
          unhealthyBackends: allBackends.filter(b => !b.healthy).length
        }), {
          headers: { 'Content-Type': 'application/json' }
        });

      case 'PUT':
      case 'POST':
        // Update a specific backend or add a new backend
        try {
          const url = new URL(request.url);
          const backendId = url.searchParams.get('id');
          
          if (!backendId && request.method === 'POST') {
            // Add new backend
            const newBackendData = await request.json() as {
              url: string;
              poolId?: string;
              weight?: number;
              priority?: number;
              enabled?: boolean;
            };
            
            const addedBackend = await this.addBackend(newBackendData);
            
            if (!addedBackend) {
              return new Response(JSON.stringify({ error: 'Failed to add backend' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
              });
            }

            return new Response(JSON.stringify({ 
              success: true, 
              backend: addedBackend,
              message: 'Backend added successfully'
            }), {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          
          if (!backendId) {
            return new Response(JSON.stringify({ error: 'Backend ID is required for updates' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          const updates = await request.json() as Partial<Backend>;
          const updatedBackend = await this.updateBackend(backendId, updates);
          
          if (!updatedBackend) {
            return new Response(JSON.stringify({ error: 'Backend not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          return new Response(JSON.stringify({ 
            success: true, 
            backend: updatedBackend,
            message: 'Backend updated successfully'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            error: 'Failed to process backend request',
            details: error instanceof Error ? error.message : 'Unknown error'
          }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

      default:
        return new Response('Method not allowed', { status: 405 });
    }
  }

  private async handleHealthRequest(): Promise<Response> {
    // Perform health checks on all backends and return status
    const healthResults = [];
    
    for (const pool of this.config.pools) {
      for (const backend of pool.backends) {
        let healthStatus = {
          backendId: backend.id,
          url: backend.url,
          poolId: pool.id,
          poolName: pool.name,
          healthy: backend.healthy,
          consecutiveFailures: backend.consecutiveFailures,
          lastFailureTimestamp: backend.lastFailureTimestamp,
          status: backend.status || 'Unknown',
          enabled: backend.enabled
        };

        // If active health checks are enabled, perform a health check
        if (this.config.activeHealthChecks?.enabled) {
          try {
            const isHealthy = await this.handleActiveHealthCheck(backend);
            healthStatus.healthy = isHealthy;
            healthStatus.status = isHealthy ? 'Active check passed' : 'Active check failed';
          } catch (error) {
            healthStatus.healthy = false;
            healthStatus.status = `Active check error: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
        }

        healthResults.push(healthStatus);
      }
    }

    const summary = {
      totalBackends: healthResults.length,
      healthyBackends: healthResults.filter(h => h.healthy).length,
      unhealthyBackends: healthResults.filter(h => !h.healthy).length,
      disabledBackends: healthResults.filter(h => !h.enabled).length,
      activeHealthChecksEnabled: this.config.activeHealthChecks?.enabled || false,
      passiveHealthChecksEnabled: this.config.passiveHealthChecks?.enabled || false
    };

    return new Response(JSON.stringify({
      summary,
      backends: healthResults,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async handleInitializeRequest(request: Request): Promise<Response> {
    try {
      const initData = await request.json() as {
        hostname: string;
        backends: string[];
        mode: string;
        source: string;
      };

      if (this.debug) {
        console.log(`[${this.serviceHostname}] Initialize request:`, initData);
      }

      // Force re-initialization with the provided data
      await this.initializeEmptyConfig(initData.hostname);
      
      return new Response(JSON.stringify({
        success: true,
        message: `Service ${initData.hostname} initialized successfully`,
        config: {
          serviceId: this.config.serviceId,
          mode: this.config.mode,
          pools: this.config.pools.length,
          backends: this.config.pools.reduce((count, pool) => count + pool.backends.length, 0)
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error(`[${this.serviceHostname}] Initialize error:`, error);
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to initialize service',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async handleConfigRequest(request: Request): Promise<Response> {
    const method = request.method;

    switch (method) {
      case 'GET':
        // Return current configuration
        return new Response(JSON.stringify({
          mode: this.config.mode || 'simple',
          serviceId: this.config.serviceId,
          backends: this.config.simpleBackends || this.config.pools.flatMap(p => p.backends.map(b => b.url)),
          pools: this.config.pools,
          load_balancer: this.config.load_balancer,
          activeHealthChecks: this.config.activeHealthChecks,
          passiveHealthChecks: this.config.passiveHealthChecks,
          metrics: this.metrics,
          source: this.config.simpleBackends ? 'default' : 'custom'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });

      case 'PUT':
      case 'POST':
        // Update configuration
        try {
          const newConfig = await request.json() as ConfigurationUpdateRequest;
          
          if (this.debug) {
            console.log(`[${this.serviceHostname}] Updating config with:`, {
              mode: newConfig.mode,
              simpleBackends: newConfig.simpleBackends,
              backends: newConfig.backends,
              hasPoolsUpdate: !!newConfig.pools
            });
          }
          
          // Merge with existing config
          if (newConfig.mode) {
            this.config.mode = newConfig.mode;
          }
          
          // Handle backends array format (from PowerShell script)
          if (newConfig.backends && Array.isArray(newConfig.backends)) {
            // Convert backends array to pool structure
            this.config.mode = 'simple';
            this.config.simpleBackends = newConfig.backends.map((b: any) => b.url);
            this.config.pools = [{
              id: "simple-pool",
              name: "Simple Failover Pool",
              backends: newConfig.backends.map((backend: any, index: number) => ({
                id: `backend-${index}`,
                url: backend.url.trim(),
                ip: new URL(backend.url.trim()).hostname,
                weight: backend.weight || 1,
                healthy: backend.healthy !== undefined ? backend.healthy : true,
                consecutiveFailures: 0,
                requests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                totalResponseTimeMs: 0,
                priority: 10,
                enabled: true
              })),
              enabled: true,
              minimum_origins: 1,
              endpoint_steering: 'round_robin'
            }];
          } else if (newConfig.simpleBackends) {
            // Simple mode - convert backends to pool structure
            this.config.simpleBackends = newConfig.simpleBackends;
            this.config.pools = [{
              id: "simple-pool",
              name: "Simple Failover Pool",
              backends: newConfig.simpleBackends.map((url: string, index: number) => ({
                id: `backend-${index}`,
                url: url.trim(),
                ip: new URL(url.trim()).hostname,
                weight: 1,
                healthy: true,
                consecutiveFailures: 0,
                requests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                totalResponseTimeMs: 0,
                priority: 10,
                enabled: true
              })),
              enabled: true,
              minimum_origins: 1,
              endpoint_steering: 'round_robin'
            }];
          } else if (newConfig.pools) {
            // Only update pools if we're not in simple mode with simpleBackends
            this.config.pools = newConfig.pools;
          }
          
          if (newConfig.load_balancer) {
            this.config.load_balancer = { ...this.config.load_balancer, ...newConfig.load_balancer };
          }
          
          // Handle healthCheck configuration from PowerShell script
          if (newConfig.healthCheck) {
            if (newConfig.healthCheck.active) {
              this.config.activeHealthChecks = {
                enabled: newConfig.healthCheck.active.enabled || false,
                path: newConfig.healthCheck.active.path || "/",
                interval: Math.floor((newConfig.healthCheck.active.interval || 30000) / 1000), // Convert ms to seconds
                timeout: Math.floor((newConfig.healthCheck.active.timeout || 5000) / 1000), // Convert ms to seconds
                type: 'http',
                consecutive_up: 2,
                consecutive_down: 3,
                retries: 1
              };
            }
            if (newConfig.healthCheck.passive) {
              this.config.passiveHealthChecks = {
                enabled: newConfig.healthCheck.passive.enabled || false,
                max_failures: newConfig.healthCheck.passive.failureThreshold || 3,
                failure_timeout_ms: 30000,
                retryable_status_codes: [500, 502, 503, 504],
                monitor_timeout: 10
              };
            }
          }

          // Handle sessionAffinity configuration from PowerShell script
          if (newConfig.sessionAffinity) {
            if (this.config.load_balancer) {
              const affinityType = newConfig.sessionAffinity.enabled 
                ? (newConfig.sessionAffinity.method === 'ip_hash' ? 'ip_cookie' : 'cookie') 
                : 'none';
                
              this.config.load_balancer.session_affinity = {
                type: affinityType,
                enabled: newConfig.sessionAffinity.enabled || false,
                cookieName: newConfig.sessionAffinity.cookieName || 'lb_session',
                ttl: 86400 // 24 hours in seconds
              };
              
              // Log the session affinity configuration
              if (this.debug) {
                console.log(`[${this.serviceHostname}] Session affinity configured:`, {
                  type: affinityType,
                  enabled: newConfig.sessionAffinity.enabled || false,
                  cookieName: newConfig.sessionAffinity.cookieName || 'lb_session'
                });
              }
            }
          }

          if (newConfig.activeHealthChecks) {
            this.config.activeHealthChecks = { ...this.config.activeHealthChecks, ...newConfig.activeHealthChecks };
          }
          
          if (newConfig.passiveHealthChecks) {
            this.config.passiveHealthChecks = { ...this.config.passiveHealthChecks, ...newConfig.passiveHealthChecks };
          }
          
          await this.saveConfig();
          
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            error: 'Failed to update configuration',
            details: error instanceof Error ? error.message : 'Unknown error'
          }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

      case 'DELETE':
        // Reset to empty configuration
        await this.initializeEmptyConfig(this.serviceHostname);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });

      default:
        return new Response('Method not allowed', { status: 405 });
    }
  }

  private generateMetricsHtml(): Response {
    this.calculateAvgResponseTimes();
    let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Load Balancer Metrics: ${this.serviceHostname}</title>
            <style>
                body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif; margin: 20px; background-color: #F8F9FA; color: #212529; line-height: 1.6; }
                .container { max-width: 1200px; margin: auto; padding: 20px; }
                h1, h2 { color: #343A40; border-bottom: 2px solid #DEE2E6; padding-bottom: 0.5em;}
                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; background-color: #FFF; box-shadow: 0 2px 15px rgba(0,0,0,0.05); }
                th, td { border: 1px solid #DEE2E6; padding: 12px 15px; text-align: left; vertical-align: top; }
                th { background-color: #E9ECEF; font-weight: 600; }
                tr:nth-child(even) { background-color: #F8F9FA; }
                .healthy { color: #28A745; font-weight: bold; }
                .unhealthy { color: #DC3545; font-weight: bold; }
                .status-details { font-size: 0.85em; color: #6C757D; margin-top: 4px; display: block;}
                .config-section, .summary-section { background-color: #FFF; padding: 20px; margin-bottom: 30px; box-shadow: 0 2px 15px rgba(0,0,0,0.05); border-radius: 8px; }
                pre { background-color: #E9ECEF; padding: 15px; border: 1px solid #CED4DA; border-radius: 5px; overflow-x: auto; font-size: 0.9em; }
                footer { text-align: center; margin-top: 40px; font-size: 0.9em; color: #6C757D; }
                .tag { display: inline-block; padding: .25em .4em; font-size: 75%; font-weight: 700; line-height: 1; text-align: center; white-space: nowrap; vertical-align: baseline; border-radius: .25rem; }
                .tag-healthy { color: #FFF; background-color: #28A745; }
                .tag-unhealthy { color: #FFF; background-color: #DC3545; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Load Balancer Metrics: ${this.serviceHostname}</h1>

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

    this.config.pools.forEach(pool => {
      pool.backends.forEach((b: Backend) => {
        const metrics = this.metrics.backendMetrics[b.id] || { requests: 0, successfulRequests: 0, failedRequests: 0, totalResponseTimeMs: 0, avgResponseTimeMs: 0 };
        html += `
                <tr>
                    <td>${b.id}</td>
                    <td><a href="${b.url}" target="_blank">${b.url}</a></td>
                    <td>${b.weight}</td>
                    <td>
                        <span class="tag ${b.healthy ? 'tag-healthy' : 'tag-unhealthy'}">${b.healthy ? 'Healthy' : 'Unhealthy'}</span>
                        ${b.status ? `<span class="status-details">Detail: ${b.status}</span>` : ''}
                    </td>
                    <td>${b.consecutiveFailures}</td>
                    <td>${metrics.requests}</td>
                    <td>${metrics.successfulRequests}</td>
                    <td>${metrics.failedRequests}</td>
                    <td>${metrics.avgResponseTimeMs.toFixed(2)}</td>
                    <td>${b.lastFailureTimestamp ? new Date(b.lastFailureTimestamp).toLocaleString() : 'N/A'}</td>
                </tr>`;
      });
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
      await this.loadState();
    }

    const url = new URL(request.url);
    
    // Separate admin API requests from traffic to be routed
    if (url.pathname.startsWith('/__lb_admin__/')) {
      return this.handleAdminRequest(request);
    }
    
    // Health check requests
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        version: '1.0.0',
        backends: this.config.pools.reduce((count, pool) => count + pool.backends.length, 0),
        healthyBackends: this.config.pools.reduce((count, pool) => 
          count + pool.backends.filter(b => b.healthy).length, 0)
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Metrics requests
    if (url.pathname === '/metrics') {
      return this.generateMetricsHtml();
    }
    
    // Clear session cookies for testing
    if (url.pathname === '/clear-session') {
      const sessionAffinity = this.config.load_balancer.session_affinity;
      const cookieName = sessionAffinity?.cookieName || 'lb_session';
      
      return new Response(JSON.stringify({
        success: true,
        message: `Session affinity cookie '${cookieName}' cleared`
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `${cookieName}=; Path=/; Max-Age=0; SameSite=Lax; Secure;`
        }
      });
    }
    
    // For a real load balancer - Route the traffic
    try {
      let selectedBackend: Backend | null = null;
      let responseHeaders: Record<string, string> = {};
      
      // Use the LoadBalancerEngine for sophisticated pool selection and backend routing
      if (this.loadBalancerEngine) {
        try {
          const clientIp = this.getClientIp(request) || '127.0.0.1';
          const routingResult = await this.loadBalancerEngine.routeRequest(request, clientIp);
          selectedBackend = routingResult.backend;
          responseHeaders = routingResult.headers;
        } catch (error) {
          // Handle special routing actions (fixed response, redirect)
          if (error instanceof Error) {
            if (error.name === 'FixedResponseAction') {
              const fixedResponse = (error as any).response;
              return new Response(fixedResponse.content, {
                status: fixedResponse.status,
                headers: {
                  'Content-Type': fixedResponse.contentType,
                  ...fixedResponse.headers
                }
              });
            } else if (error.name === 'RedirectAction') {
              const redirectResponse = (error as any).response;
              return new Response(null, {
                status: redirectResponse.status,
                headers: {
                  'Location': redirectResponse.url,
                  ...redirectResponse.headers
                }
              });
            }
          }
          throw error; // Re-throw if not a special action
        }
      } else {
        // Fallback to simple backend selection if engine is not available
        selectedBackend = this.selectBackend(request);
      }
      
      if (!selectedBackend) {
        return new Response("No healthy backends available", { status: 503 });
      }
      
      const response = await this.forwardRequest(request, selectedBackend);
      
      // Add any additional headers from the routing engine
      if (Object.keys(responseHeaders).length > 0) {
        const newHeaders = new Headers(response.headers);
        Object.entries(responseHeaders).forEach(([key, value]) => {
          newHeaders.set(key, value);
        });
        
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }
      
      return response;
    } catch (error) {
      console.error(`[${this.serviceHostname}] Error routing request: ${error}`);
      return new Response(`Error routing request: ${error}`, { status: 500 });
    }
  }

  async alarm() {
    if (!this.initialized) {
      await this.loadState();
    }
    
    const now = Date.now();
    
    if (!this.config.activeHealthChecks?.enabled) {
      console.log(`[${this.serviceHostname}] Active health checks disabled, not performing checks`);
      return;
    }
    
    console.log(`[${this.serviceHostname}] Running active health checks`);
    
    try {
      // Check health of all backends
      const checkPromises: Promise<boolean>[] = [];
      
      for (const pool of this.config.pools) {
        for (const backend of pool.backends) {
          checkPromises.push(this.handleActiveHealthCheck(backend));
        }
      }
      
      await Promise.all(checkPromises);
      await this.saveConfig();
      
      // Schedule next health check
      const interval = this.config.activeHealthChecks.interval * 1000;
      this.state.storage.setAlarm(now + interval);
      
      console.log(`[${this.serviceHostname}] Active health checks completed, next check in ${interval / 1000}s`);
    } catch (error) {
      console.error(`[${this.serviceHostname}] Error during active health checks:`, error);
      
      // Still schedule next check even if this one failed
      const interval = this.config.activeHealthChecks.interval * 1000;
      this.state.storage.setAlarm(now + interval);
    }
  }

  // Main fetch method - required entry point for Durable Object HTTP requests
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.handleRequest(request);
    } catch (error) {
      console.error(`[${this.serviceHostname}] Unhandled error in fetch: ${error}`);
      return new Response(`Server error: ${error}`, { status: 500 });
    }
  }

  // Load Balancer Management Methods
  async handleGetLoadBalancers(): Promise<Response> {
    try {
      const loadBalancers: LoadBalancer[] = [];
      
      // Always include the current service's load balancer
      loadBalancers.push(this.config.load_balancer);
      
      // Get all stored load balancers
      const allKeys = await this.state.storage.list({ prefix: "loadbalancer:" });
      
      for (const [key, value] of allKeys) {
        // Skip non-load balancer keys (like metrics, alerts, etc.)
        if (key.includes(':metrics') || key.includes(':alerts') || key.includes(':health_checks')) {
          continue;
        }
        
        const lbId = key.replace('loadbalancer:', '');
        
        // Skip if it's the current service's load balancer (already added)
        if (lbId === this.config.load_balancer.id) {
          continue;
        }
        
        if (value && typeof value === 'object') {
          loadBalancers.push(value as LoadBalancer);
        }
      }
      
      // Sort by name for consistent ordering
      loadBalancers.sort((a, b) => a.name.localeCompare(b.name));
      
      return new Response(JSON.stringify({
        success: true,
        load_balancers: loadBalancers,
        count: loadBalancers.length
      }), { headers: { "Content-Type": "application/json" } });
    } catch (error: any) {
      console.error(`[${this.serviceHostname}] Error retrieving load balancers: ${error.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to get load balancers",
        details: error.message
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  async handleCreateLoadBalancer(request: Request): Promise<Response> {
    try {
      const config = await request.json() as CreateLoadBalancerRequest;
      
      if (!config || typeof config !== 'object') {
        return new Response("Invalid configuration: Expected object", { status: 400 });
      }
      
      // Validate required fields
      if (!config.name || !config.hostname) {
        return new Response("Invalid configuration: Missing required fields (name, hostname)", { status: 400 });
      }
      
      // Create a new load balancer with the provided configuration
      const loadBalancer: LoadBalancer = {
        id: crypto.randomUUID(),
        name: config.name,
        description: config.description || '',
        hostname: config.hostname,
        fallback_pool_id: config.fallback_pool_id,
        default_pool_ids: config.default_pool_ids || [],
        proxied: config.proxied !== undefined ? config.proxied : true,
        enabled: true,
        steering_policy: config.steering_policy || 'off',
        session_affinity: config.session_affinity,
        dns_failover: config.dns_failover,
        ttl: config.ttl || 60
      };
      
      // Check if this should replace the current service's load balancer
      // or be stored as an additional load balancer
      if (config.hostname === this.serviceHostname) {
        // Update the current service's load balancer
        this.config.load_balancer = loadBalancer;
        
        // Update the LoadBalancerEngine with the new config
        if (this.loadBalancerEngine) {
          this.loadBalancerEngine.updateConfig(this.config);
        }
        
        await this.saveConfig();
      } else {
        // Store as an additional load balancer
        await this.state.storage.put(`loadbalancer:${loadBalancer.id}`, loadBalancer);
        
        // Also store the pools if provided
        if (config.pools && config.pools.length > 0) {
          await this.state.storage.put(`loadbalancer:${loadBalancer.id}:pools`, config.pools);
        }
      }
      
      return new Response(JSON.stringify({
        success: true,
        message: "Load balancer created successfully",
        loadBalancer
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error(`[${this.serviceHostname}] Error creating load balancer: ${error}`);
      return new Response(`Error creating load balancer: ${error}`, { status: 500 });
    }
  }

  async handleGetLoadBalancer(lbId: string): Promise<Response> {
    try {
      // Check if the requested load balancer ID matches the current service's load balancer
      if (this.config.load_balancer.id === lbId) {
        return new Response(JSON.stringify({
          success: true,
          load_balancer: this.config.load_balancer
        }), { headers: { "Content-Type": "application/json" } });
      }
      
      // Try to retrieve from storage if it's a different load balancer
      const storedLb = await this.state.storage.get(`loadbalancer:${lbId}`);
      
      if (storedLb) {
        return new Response(JSON.stringify({
          success: true,
          load_balancer: storedLb
        }), { headers: { "Content-Type": "application/json" } });
      }
      
      return new Response(JSON.stringify({
        success: false,
        error: "Load balancer not found"
      }), { status: 404, headers: { "Content-Type": "application/json" } });
    } catch (error: any) {
      console.error(`[${this.serviceHostname}] Error retrieving load balancer ${lbId}: ${error.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to get load balancer",
        details: error.message
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  async handleUpdateLoadBalancer(lbId: string, request: Request): Promise<Response> {
    try {
      const updates = await request.json() as Partial<LoadBalancer>;
      
      // Validate the updates
      if (!updates || typeof updates !== 'object') {
        return new Response(JSON.stringify({
          success: false,
          error: "Invalid update data: Expected object"
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      
      // Check if updating the current service's load balancer
      if (this.config.load_balancer.id === lbId) {
        // Update the current load balancer configuration
        this.config.load_balancer = {
          ...this.config.load_balancer,
          ...updates,
          id: lbId // Ensure ID doesn't change
        };
        
        // Update the LoadBalancerEngine with the new config
        if (this.loadBalancerEngine) {
          this.loadBalancerEngine.updateConfig(this.config);
        }
        
        // Save the updated configuration
        await this.saveConfig();
        
        return new Response(JSON.stringify({
          success: true,
          message: "Load balancer updated successfully",
          load_balancer: this.config.load_balancer
        }), { headers: { "Content-Type": "application/json" } });
      }
      
      // Try to retrieve and update from storage if it's a different load balancer
      const storedLb = await this.state.storage.get(`loadbalancer:${lbId}`) as LoadBalancer;
      
      if (!storedLb) {
        return new Response(JSON.stringify({
          success: false,
          error: "Load balancer not found"
        }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      
      // Update the stored load balancer
      const updatedLb: LoadBalancer = {
        ...storedLb,
        ...updates,
        id: lbId // Ensure ID doesn't change
      };
      
      // Store the updated load balancer
      await this.state.storage.put(`loadbalancer:${lbId}`, updatedLb);
      
      return new Response(JSON.stringify({
        success: true,
        message: "Load balancer updated successfully",
        load_balancer: updatedLb
      }), { headers: { "Content-Type": "application/json" } });
      
    } catch (error: any) {
      console.error(`[${this.serviceHostname}] Error updating load balancer ${lbId}: ${error.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to update load balancer",
        details: error.message
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  async handleDeleteLoadBalancer(lbId: string): Promise<Response> {
    try {
      // Check if trying to delete the current service's load balancer
      if (this.config.load_balancer.id === lbId) {
        // Cannot delete the active load balancer - disable it instead
        this.config.load_balancer.enabled = false;
        
        // Update the LoadBalancerEngine with the new config
        if (this.loadBalancerEngine) {
          this.loadBalancerEngine.updateConfig(this.config);
        }
        
        // Save the updated configuration
        await this.saveConfig();
        
        return new Response(JSON.stringify({
          success: true,
          message: "Active load balancer disabled (cannot be deleted while in use)",
          load_balancer: this.config.load_balancer
        }), { headers: { "Content-Type": "application/json" } });
      }
      
      // Try to retrieve from storage to confirm it exists
      const storedLb = await this.state.storage.get(`loadbalancer:${lbId}`);
      
      if (!storedLb) {
        return new Response(JSON.stringify({
          success: false,
          error: "Load balancer not found"
        }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      
      // Delete the load balancer from storage
      await this.state.storage.delete(`loadbalancer:${lbId}`);
      
      // Also delete any associated data
      const keysToDelete = [
        `loadbalancer:${lbId}:metrics`,
        `loadbalancer:${lbId}:alerts`,
        `loadbalancer:${lbId}:health_checks`
      ];
      
      await Promise.all(
        keysToDelete.map(key => this.state.storage.delete(key))
      );
      
      console.log(`[${this.serviceHostname}] Load balancer ${lbId} deleted successfully`);
      
      return new Response(JSON.stringify({
        success: true,
        message: "Load balancer deleted successfully"
      }), { headers: { "Content-Type": "application/json" } });
      
    } catch (error: any) {
      console.error(`[${this.serviceHostname}] Error deleting load balancer ${lbId}: ${error.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to delete load balancer",
        details: error.message
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // Pool Management Methods
  async handleGetPools(): Promise<Response> {
    return new Response(JSON.stringify({
      success: true,
      pools: this.config.pools
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  private async handleActiveHealthCheck(backend: Backend): Promise<boolean> {
    try {
      // Skip if not enabled
      const config = this.config.activeHealthChecks;
      if (!config || !config.enabled) return backend.healthy;

      // Construct the health check URL
      const url = new URL(config.path, backend.url).toString();
      
      // Send the health check request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout * 1000);
      
      const response = await fetch(url, {
        method: config.method || 'GET',
        headers: config.headers || {},
        redirect: config.follow_redirects ? 'follow' : 'manual',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Check if status code is acceptable
      const isStatusValid = config.expected_codes 
        ? config.expected_codes.includes(response.status)
        : response.status < 400;
      
      // Check body content if expected_body is configured
      let isBodyValid = true;
      if (config.expected_body) {
        const body = await response.text();
        isBodyValid = body.includes(config.expected_body);
      }
      
      // Update backend health based on check results
      const isHealthy = isStatusValid && isBodyValid;
      
      if (isHealthy) {
        backend.consecutiveFailures = 0;
        if (!backend.healthy) {
          backend.healthy = true;
          console.log(`[${this.serviceHostname}] ActiveHealthCheck: Backend ${backend.id} is now healthy`);
          await this.saveConfig();
        }
      } else {
        backend.consecutiveFailures++;
        if (backend.consecutiveFailures >= config.consecutive_down && backend.healthy) {
          backend.healthy = false;
          backend.lastFailureTimestamp = Date.now();
          console.warn(`[${this.serviceHostname}] ActiveHealthCheck: Backend ${backend.id} is now unhealthy`);
          await this.saveConfig();
        }
      }
      
      return backend.healthy;
    } catch (error) {
      console.error(`[${this.serviceHostname}] ActiveHealthCheck error for ${backend.id}: ${error}`);
      backend.consecutiveFailures++;
      
      if (backend.consecutiveFailures >= (this.config.activeHealthChecks?.consecutive_down || 3) && backend.healthy) {
        backend.healthy = false;
        backend.lastFailureTimestamp = Date.now();
        await this.saveConfig();
      }
      
      return backend.healthy;
    }
  }

  private async handlePassiveHealthCheck(backend: Backend, statusCode: number, responseTimeMs?: number): Promise<boolean> {
    // Update health check metrics if they exist
    if (this.metrics.backendMetrics[backend.id]) {
      const metrics = this.metrics.backendMetrics[backend.id];
      if (responseTimeMs) {
        metrics.totalResponseTimeMs += responseTimeMs;
        metrics.avgResponseTimeMs = metrics.successfulRequests > 0 
          ? metrics.totalResponseTimeMs / metrics.successfulRequests 
          : 0;
      }
    }

    // Check if status code is retryable
    const isRetryableStatus = this.config.passiveHealthChecks.retryable_status_codes.includes(statusCode);
    
    if (isRetryableStatus || statusCode >= 500) {
      backend.consecutiveFailures++;
      backend.lastFailureTimestamp = Date.now();
      
      // Check if max failures threshold is reached
      if (backend.consecutiveFailures >= this.config.passiveHealthChecks.max_failures) {
        if (backend.healthy) {
          backend.healthy = false;
          await this.saveConfig();
          console.warn(`[${this.serviceHostname}] PassiveHealthCheck: Backend ${backend.id} marked unhealthy after ${backend.consecutiveFailures} consecutive failures. Last status: ${statusCode}`);
          return false;
        }
      }
    } else {
      // Successful response, reset failure counter
      if (backend.consecutiveFailures > 0) {
        backend.consecutiveFailures = 0;
        if (!backend.healthy) {
          backend.healthy = true;
          await this.saveConfig();
          console.log(`[${this.serviceHostname}] PassiveHealthCheck: Backend ${backend.id} recovered and marked healthy.`);
        }
      }
    }
    
    return backend.healthy;
  }

  async handleUpdateService(request: Request): Promise<Response> {
    const update = await request.json() as UpdateServiceConfigRequest;
    
    // Apply updates to the config
    if (update.pools) {
      this.config.pools = update.pools as OriginPool[];
    }
    
    if (update.load_balancer) {
      this.config.load_balancer = {
        ...this.config.load_balancer,
        ...update.load_balancer
      };
    }
    
    if (update.currentRoundRobinIndex !== undefined) {
      this.config.currentRoundRobinIndex = update.currentRoundRobinIndex;
    }
    
    if (update.passiveHealthChecks) {
      this.config.passiveHealthChecks = {
        ...this.config.passiveHealthChecks,
        ...update.passiveHealthChecks
      };
    }
    
    if (update.activeHealthChecks) {
      this.config.activeHealthChecks = {
        ...this.config.activeHealthChecks || {
          enabled: false,
          type: 'http',
          path: '/healthz',
          timeout: 5,
          interval: 60,
          retries: 1,
          consecutive_up: 2,
          consecutive_down: 3
        },
        ...update.activeHealthChecks
      };
    }
    
    if (update.retryPolicy) {
      this.config.retryPolicy = {
        ...this.config.retryPolicy,
        ...update.retryPolicy
      };
    }
    
    if (update.hostHeaderRewrite) {
      this.config.hostHeaderRewrite = update.hostHeaderRewrite;
    }
    
    if (update.observability) {
      this.config.observability = {
        ...this.config.observability,
        ...update.observability
      };
    }
    
    await this.saveConfig();
    
    // Update the load balancer engine with new config
    if (this.loadBalancerEngine) {
      this.loadBalancerEngine.updateConfig(this.config);
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: "Service configuration updated successfully",
      serviceId: this.config.serviceId
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  private async updateBackend(backendId: string, updates: Partial<Backend>): Promise<Backend | null> {
    for (const pool of this.config.pools) {
      const backendIndex = pool.backends.findIndex(b => b.id === backendId);
      if (backendIndex !== -1) {
        // Update backend properties
        pool.backends[backendIndex] = {
          ...pool.backends[backendIndex],
          ...updates
        };
        await this.saveConfig();
        return pool.backends[backendIndex];
      }
    }
    return null; // Backend not found
  }

  /**
   * Add a new backend to a pool
   */
  private async addBackend(newBackendData: {
    url: string;
    poolId?: string;
    weight?: number;
    priority?: number;
    enabled?: boolean;
  }): Promise<Backend | null> {
    try {
      // Validate URL
      const urlObj = new URL(newBackendData.url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Invalid protocol. Only HTTP and HTTPS are supported.');
      }

      // Find target pool (default to first pool if not specified)
      let targetPool = this.config.pools[0]; // Default to first pool
      if (newBackendData.poolId) {
        const foundPool = this.config.pools.find(p => p.id === newBackendData.poolId);
        if (!foundPool) {
          throw new Error(`Pool with ID ${newBackendData.poolId} not found`);
        }
        targetPool = foundPool;
      }

      if (!targetPool) {
        throw new Error('No pools available to add backend to');
      }

      // Check if backend URL already exists
      const existingBackend = targetPool.backends.find(b => b.url === newBackendData.url);
      if (existingBackend) {
        throw new Error('Backend with this URL already exists in the pool');
      }

      // Generate unique backend ID
      const backendId = `backend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create new backend object
      const newBackend: Backend = {
        id: backendId,
        url: newBackendData.url.trim(),
        ip: urlObj.hostname,
        weight: newBackendData.weight || 1,
        healthy: true,
        consecutiveFailures: 0,
        requests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalResponseTimeMs: 0,
        priority: newBackendData.priority || 10,
        enabled: newBackendData.enabled !== undefined ? newBackendData.enabled : true
      };

      // Add backend to pool
      targetPool.backends.push(newBackend);

      // Update simple backends array if in simple mode
      if (this.config.mode === 'simple' && this.config.simpleBackends) {
        this.config.simpleBackends.push(newBackend.url);
      }

      // Save configuration
      await this.saveConfig();

      // Initialize metrics for new backend
      if (!this.metrics.backendMetrics[backendId]) {
        this.metrics.backendMetrics[backendId] = {
          requests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          totalResponseTimeMs: 0,
          avgResponseTimeMs: 0
        };
      }

      // Update load balancer engine if available
      if (this.loadBalancerEngine) {
        this.loadBalancerEngine.updateConfig(this.config);
      }

      // Log the addition
      this.addLogEntry('info', `Backend ${newBackend.url} added to pool ${targetPool.name}`, 'config', {
        backendId: newBackend.id,
        poolId: targetPool.id,
        url: newBackend.url
      });

      return newBackend;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.addLogEntry('error', `Failed to add backend: ${errorMessage}`, 'config', {
        url: newBackendData.url,
        poolId: newBackendData.poolId,
        error: errorMessage
      });
      return null;
    }
  }

  /**
   * Add a log entry to the in-memory log buffer
   */
  private addLogEntry(
    level: LogEntry['level'],
    message: string,
    category: LogEntry['category'],
    metadata?: LogEntry['metadata']
  ): void {
    const logEntry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level,
      message,
      category,
      metadata
    };

    this.logEntries.unshift(logEntry); // Add to beginning for newest first

    // Keep only the most recent entries
    if (this.logEntries.length > this.maxLogEntries) {
      this.logEntries = this.logEntries.slice(0, this.maxLogEntries);
    }

    // Also log to console for debugging
    const logLevel = level.toUpperCase();
    const timestamp = new Date(logEntry.timestamp).toISOString();
    const metadataStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
    console.log(`[${timestamp}] [${this.serviceHostname}] ${logLevel}: ${message}${metadataStr}`);
  }

  /**
   * Handle logs endpoint - retrieve logs with filtering and pagination
   */
  async handleLogsRequest(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const level = url.searchParams.get('level');
      const category = url.searchParams.get('category');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
      const offset = parseInt(url.searchParams.get('offset') || '0');

      let filteredLogs = [...this.logEntries];

      // Apply filters
      if (level) {
        filteredLogs = filteredLogs.filter(log => log.level === level);
      }
      if (category) {
        filteredLogs = filteredLogs.filter(log => log.category === category);
      }

      // Apply pagination
      const paginatedLogs = filteredLogs.slice(offset, offset + limit);

      return new Response(JSON.stringify({
        success: true,
        logs: paginatedLogs,
        total: filteredLogs.length,
        limit,
        offset,
        filters: { level, category }
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error: any) {
      console.error(`[${this.serviceHostname}] Error retrieving logs: ${error.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to retrieve logs",
        details: error.message
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  /**
   * Clear all logs
   */
  async handleClearLogsRequest(): Promise<Response> {
    try {
      this.logEntries = [];
      this.addLogEntry('info', 'Logs cleared by user request', 'system');
      
      return new Response(JSON.stringify({
        success: true,
        message: "Logs cleared successfully"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error: any) {
      console.error(`[${this.serviceHostname}] Error clearing logs: ${error.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to clear logs",
        details: error.message
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  /**
   * Get health metrics including circuit breaker states and health scores
   */
  async handleHealthMetricsRequest(): Promise<Response> {
    try {
      if (!this.loadBalancerEngine) {
        return new Response(JSON.stringify({
          success: false,
          error: "Load balancer engine not initialized"
        }), { status: 500, headers: { "Content-Type": "application/json" } });
      }

      const metrics = this.loadBalancerEngine.getHealthMetrics();
      
      return new Response(JSON.stringify({
        success: true,
        backends: metrics
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error: any) {
      console.error(`[${this.serviceHostname}] Error retrieving health metrics: ${error.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to retrieve health metrics",
        details: error.message
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }
}
