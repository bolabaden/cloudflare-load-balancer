import { 
  LoadBalancerServiceConfig, 
  Backend, 
  OriginPool, 
  LoadBalancer,
  TrafficSteeringMethod,
  EndpointSteeringMethod,
  SessionAffinityConfig,
  DnsFailoverConfig,
  DnsState,
  HealthCheckResult,
  ServiceMetrics,
  PoolMetrics,
  BackendMetrics,
  GeographicData,
  NetworkPath,
  Alert,
  LoadBalancerRule,
  RuleAction
} from './types';

export class LoadBalancerEngine {
  private config: LoadBalancerServiceConfig;
  private metrics: ServiceMetrics;
  private dnsState?: DnsState;
  private sessionAffinityCache = new Map<string, { poolId: string; backendId: string; expires: number }>();
  private healthCheckResults = new Map<string, HealthCheckResult>();
  private alertHistory: Alert[] = [];
  private rttCache = new Map<string, { [region: string]: number }>(); // Pool RTT data for dynamic steering
  
  constructor(config: LoadBalancerServiceConfig) {
    this.config = config;
    this.metrics = this.initializeMetrics();
    
    if (this.config.load_balancer.dns_failover?.enabled) {
      this.dnsState = this.initializeDnsState();
    }
  }
  
  private initializeMetrics(): ServiceMetrics {
    const backendMetrics: Record<string, BackendMetrics> = {};
    const poolMetrics: Record<string, PoolMetrics> = {};
    
    this.config.pools.forEach(pool => {
      poolMetrics[pool.id] = {
        poolId: pool.id,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0,
        activeConnections: 0,
        avgResponseTime: 0,
        healthyOrigins: pool.backends.filter(b => b.healthy).length,
        totalOrigins: pool.backends.length
      };
      
      pool.backends.forEach(backend => {
        backendMetrics[backend.id] = {
          requests: backend.requests || 0,
          successfulRequests: backend.successfulRequests || 0,
          failedRequests: backend.failedRequests || 0,
          totalResponseTimeMs: backend.totalResponseTimeMs || 0,
          avgResponseTimeMs: 0,
          lastRequestTimestamp: Date.now()
        };
      });
    });
    
    return {
      serviceId: this.config.serviceId,
      totalRequests: 0,
      totalSuccessfulRequests: 0,
      totalFailedRequests: 0,
      backendMetrics,
      poolMetrics,
      dnsFailovers: 0,
      dnsRecoveries: 0,
      steeringDecisions: {},
      sessionAffinityHits: 0,
      sessionAffinityMisses: 0
    };
  }
  
  private initializeDnsState(): DnsState {
    const primaryPool = this.config.pools.find(p => p.id === this.config.load_balancer.dns_failover?.primary_pool_id);
    const healthyBackends = primaryPool?.backends.filter(b => b.healthy && b.enabled) || [];
    
    return {
      current_pool_id: this.config.load_balancer.dns_failover!.primary_pool_id,
      current_backend_ips: healthyBackends.map(b => b.ip),
      failover_state: 'primary',
      failure_count: 0,
      recovery_count: 0,
      health_check_results: {}
    };
  }
  
  /**
   * Main entry point for routing a request
   */
  public async routeRequest(
    request: Request, 
    clientIp: string, 
    geo?: GeographicData
  ): Promise<{ backend: Backend; pool: OriginPool; headers: Record<string, string> }> {
    const startTime = Date.now();
    
    try {
      // Apply custom rules first
      const ruleResult = await this.applyCustomRules(request, clientIp, geo);
      if (ruleResult) {
        return ruleResult;
      }
      
      // Check session affinity
      const affinityResult = this.checkSessionAffinity(request, clientIp);
      if (affinityResult) {
        this.metrics.sessionAffinityHits!++;
        return affinityResult;
      }
      
      this.metrics.sessionAffinityMisses!++;
      
      // Select pool using traffic steering
      const selectedPool = await this.selectPool(request, clientIp, geo);
      if (!selectedPool) {
        throw new Error('No healthy pools available');
      }
      
      // Select backend within pool using endpoint steering
      const selectedBackend = await this.selectBackend(selectedPool, request, clientIp);
      if (!selectedBackend) {
        throw new Error(`No healthy backends in pool ${selectedPool.id}`);
      }
      
      // Update session affinity if configured
      this.updateSessionAffinity(request, clientIp, selectedPool.id, selectedBackend.id);
      
      // Prepare response headers
      const headers = this.prepareResponseHeaders(selectedBackend, selectedPool);
      
      // Update metrics
      this.updateMetrics(selectedBackend.id, selectedPool.id, startTime);
      
      // Record steering decision
      const steeringMethod = this.config.load_balancer.steering_policy;
      this.metrics.steeringDecisions![steeringMethod] = (this.metrics.steeringDecisions![steeringMethod] || 0) + 1;
      
      return { backend: selectedBackend, pool: selectedPool, headers };
      
    } catch (error) {
      this.metrics.totalFailedRequests++;
      throw error;
    }
  }
  
  /**
   * Apply custom load balancer rules
   */
  private async applyCustomRules(
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): Promise<{ backend: Backend; pool: OriginPool; headers: Record<string, string> } | null> {
    const rules = this.config.load_balancer.rules?.filter(r => r.enabled)
      .sort((a, b) => a.priority - b.priority) || [];
      
    for (const rule of rules) {
      if (await this.evaluateRuleCondition(rule.condition, request, clientIp, geo)) {
        return this.executeRuleAction(rule.action, request, clientIp, geo);
      }
    }
    
    return null;
  }
  
  private async evaluateRuleCondition(
    condition: string,
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): Promise<boolean> {
    // Simplified rule evaluation - in production this would be more sophisticated
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());
    
    // Replace variables in condition
    const evaluatedCondition = condition
      .replace(/\$\{url\.path\}/g, url.pathname)
      .replace(/\$\{url\.hostname\}/g, url.hostname)
      .replace(/\$\{request\.method\}/g, request.method)
      .replace(/\$\{client\.ip\}/g, clientIp)
      .replace(/\$\{geo\.country\}/g, geo?.country || '')
      .replace(/\$\{geo\.region\}/g, geo?.region || '');
    
    // Simple condition evaluation (would use a proper expression parser in production)
    try {
      return new Function('headers', `return ${evaluatedCondition}`)(headers);
    } catch {
      return false;
    }
  }
  
  private async executeRuleAction(
    action: RuleAction,
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): Promise<{ backend: Backend; pool: OriginPool; headers: Record<string, string> } | null> {
    switch (action.type) {
      case 'forward':
        if (action.pool_id) {
          const pool = this.config.pools.find(p => p.id === action.pool_id);
          if (pool) {
            const backend = await this.selectBackend(pool, request, clientIp);
            if (backend) {
              return {
                backend,
                pool,
                headers: this.prepareResponseHeaders(backend, pool)
              };
            }
          }
        }
        break;
        
      case 'fixed_response':
        // For fixed responses, we'd need to handle this differently
        // This is just a placeholder
        break;
        
      case 'redirect':
        // Handle redirects
        break;
        
      case 'rewrite':
        // Handle URL rewrites
        break;
    }
    
    return null;
  }
  
  /**
   * Check for existing session affinity
   */
  private checkSessionAffinity(request: Request, clientIp: string): { backend: Backend; pool: OriginPool; headers: Record<string, string> } | null {
    const sessionConfig = this.config.load_balancer.session_affinity;
    if (!sessionConfig?.enabled || sessionConfig.type === 'none') {
      return null;
    }
    
    let sessionKey: string;
    
    switch (sessionConfig.type) {
      case 'cookie':
        const cookieHeader = request.headers.get('Cookie');
        if (!cookieHeader) return null;
        const cookies = this.parseCookies(cookieHeader);
        const affinityCookie = cookies[sessionConfig.cookieName || 'lb_affinity'];
        if (!affinityCookie) return null;
        sessionKey = affinityCookie;
        break;
        
      case 'ip_cookie':
        sessionKey = clientIp;
        break;
        
      case 'header':
        const headerValue = request.headers.get(sessionConfig.header_name || 'X-Session-ID');
        if (!headerValue) return null;
        sessionKey = headerValue;
        break;
        
      default:
        return null;
    }
    
    const affinity = this.sessionAffinityCache.get(sessionKey);
    if (!affinity || affinity.expires < Date.now()) {
      if (affinity) {
        this.sessionAffinityCache.delete(sessionKey);
      }
      return null;
    }
    
    // Find the backend and pool
    const pool = this.config.pools.find(p => p.id === affinity.poolId);
    const backend = pool?.backends.find(b => b.id === affinity.backendId && b.healthy && b.enabled);
    
    if (pool && backend) {
      return {
        backend,
        pool,
        headers: this.prepareResponseHeaders(backend, pool)
      };
    }
    
    // Backend/pool not available, remove affinity
    this.sessionAffinityCache.delete(sessionKey);
    return null;
  }
  
  /**
   * Update session affinity cache
   */
  private updateSessionAffinity(request: Request, clientIp: string, poolId: string, backendId: string): void {
    const sessionConfig = this.config.load_balancer.session_affinity;
    if (!sessionConfig?.enabled || sessionConfig.type === 'none') {
      return;
    }
    
    let sessionKey: string;
    const ttl = sessionConfig.ttl || 82800; // 23 hours default
    const expires = Date.now() + (ttl * 1000);
    
    switch (sessionConfig.type) {
      case 'cookie':
        // Generate session key for cookie
        sessionKey = this.generateSessionKey();
        break;
        
      case 'ip_cookie':
        sessionKey = clientIp;
        break;
        
      case 'header':
        const headerValue = request.headers.get(sessionConfig.header_name || 'X-Session-ID');
        if (!headerValue) return;
        sessionKey = headerValue;
        break;
        
      default:
        return;
    }
    
    this.sessionAffinityCache.set(sessionKey, { poolId, backendId, expires });
  }
  
  /**
   * Select pool using traffic steering algorithm
   */
  private async selectPool(request: Request, clientIp: string, geo?: GeographicData): Promise<OriginPool | null> {
    const enabledPools = this.config.pools.filter(p => p.enabled && this.isPoolHealthy(p));
    if (enabledPools.length === 0) {
      return this.getFallbackPool();
    }
    
    const steeringMethod = this.config.load_balancer.steering_policy;
    
    switch (steeringMethod) {
      case 'off':
        return this.selectPoolFailover(enabledPools);
        
      case 'random':
        return this.selectPoolRandom(enabledPools);
        
      case 'geo':
        return this.selectPoolGeo(enabledPools, geo);
        
      case 'dynamic':
        return await this.selectPoolDynamic(enabledPools, geo);
        
      case 'proximity':
        return this.selectPoolProximity(enabledPools, geo);
        
      case 'least_outstanding_requests':
        return this.selectPoolLeastOutstandingRequests(enabledPools);
        
      case 'dns_failover':
        return await this.selectPoolDnsFailover(enabledPools);
        
      default:
        return this.selectPoolRandom(enabledPools);
    }
  }
  
  private selectPoolFailover(pools: OriginPool[]): OriginPool | null {
    // Return pools in priority order (based on order in default_pool_ids)
    const poolOrder = this.config.load_balancer.default_pool_ids;
    
    for (const poolId of poolOrder) {
      const pool = pools.find(p => p.id === poolId);
      if (pool && this.isPoolHealthy(pool)) {
        return pool;
      }
    }
    
    return pools[0] || null;
  }
  
  private selectPoolRandom(pools: OriginPool[]): OriginPool | null {
    if (pools.length === 0) return null;
    
    // Calculate total weight
    const totalWeight = pools.reduce((sum, pool) => sum + (pool.backends.length || 1), 0);
    let random = Math.random() * totalWeight;
    
    for (const pool of pools) {
      const weight = pool.backends.length || 1;
      random -= weight;
      if (random <= 0) {
        return pool;
      }
    }
    
    return pools[pools.length - 1];
  }
  
  private selectPoolGeo(pools: OriginPool[], geo?: GeographicData): OriginPool | null {
    if (!geo) return this.selectPoolRandom(pools);
    
    // Check country-specific pools first
    if (this.config.load_balancer.country_pools?.[geo.country]) {
      const countryPoolIds = this.config.load_balancer.country_pools[geo.country];
      const countryPools = pools.filter(p => countryPoolIds.includes(p.id));
      if (countryPools.length > 0) {
        return this.selectPoolRandom(countryPools);
      }
    }
    
    // Check region-specific pools
    if (this.config.load_balancer.region_pools?.[geo.region]) {
      const regionPoolIds = this.config.load_balancer.region_pools[geo.region];
      const regionPools = pools.filter(p => regionPoolIds.includes(p.id));
      if (regionPools.length > 0) {
        return this.selectPoolRandom(regionPools);
      }
    }
    
    return this.selectPoolRandom(pools);
  }
  
  private async selectPoolDynamic(pools: OriginPool[], geo?: GeographicData): Promise<OriginPool | null> {
    // Dynamic steering uses RTT data to select the fastest pool
    const region = geo?.region || 'default';
    
    // Calculate RTT scores for each pool
    const poolRtts: Array<{ pool: OriginPool; rtt: number }> = [];
    
    for (const pool of pools) {
      const cachedRtt = this.rttCache.get(pool.id)?.[region];
      const rtt = cachedRtt || await this.measurePoolRtt(pool, region);
      poolRtts.push({ pool, rtt });
    }
    
    // Sort by RTT (lower is better)
    poolRtts.sort((a, b) => a.rtt - b.rtt);
    
    return poolRtts[0]?.pool || null;
  }
  
  private selectPoolProximity(pools: OriginPool[], geo?: GeographicData): OriginPool | null {
    if (!geo || !geo.latitude || !geo.longitude) {
      return this.selectPoolRandom(pools);
    }
    
    // Calculate distance to each pool
    const poolDistances: Array<{ pool: OriginPool; distance: number }> = [];
    
    for (const pool of pools) {
      if (pool.latitude !== undefined && pool.longitude !== undefined) {
        const distance = this.calculateDistance(
          geo.latitude, geo.longitude,
          pool.latitude, pool.longitude
        );
        poolDistances.push({ pool, distance });
      }
    }
    
    // Sort by distance (closer is better)
    poolDistances.sort((a, b) => a.distance - b.distance);
    
    return poolDistances[0]?.pool || this.selectPoolRandom(pools);
  }
  
  private selectPoolLeastOutstandingRequests(pools: OriginPool[]): OriginPool | null {
    // LORS - Select pool with least outstanding requests, factoring in weight
    const poolScores: Array<{ pool: OriginPool; score: number }> = [];
    
    for (const pool of pools) {
      const weight = pool.backends.length || 1;
      const outstandingRequests = pool.backends.reduce((sum, b) => sum + (b.outstandingRequests || 0), 0);
      
      // Calculate transformed weight: weight / (outstanding_requests + 1)
      const transformedWeight = weight / (outstandingRequests + 1);
      poolScores.push({ pool, score: transformedWeight });
    }
    
    // Sort by score (higher is better)
    poolScores.sort((a, b) => b.score - a.score);
    
    // Use weighted random selection based on scores
    const totalScore = poolScores.reduce((sum, p) => sum + p.score, 0);
    let random = Math.random() * totalScore;
    
    for (const { pool, score } of poolScores) {
      random -= score;
      if (random <= 0) {
        return pool;
      }
    }
    
    return poolScores[0]?.pool || null;
  }
  
  private async selectPoolDnsFailover(pools: OriginPool[]): Promise<OriginPool | null> {
    if (!this.dnsState || !this.config.load_balancer.dns_failover) {
      return this.selectPoolRandom(pools);
    }
    
    const dnsConfig = this.config.load_balancer.dns_failover;
    
    // Check if we should failover or recover
    await this.updateDnsFailoverState();
    
    // Return current pool based on DNS failover state
    switch (this.dnsState.failover_state) {
      case 'primary':
        const primaryPool = pools.find(p => p.id === dnsConfig.primary_pool_id);
        return primaryPool || this.handleDnsFailover();
        
      case 'failover':
        // Use the first available failover pool
        for (const poolId of dnsConfig.failover_pool_ids) {
          const pool = pools.find(p => p.id === poolId);
          if (pool && this.isPoolHealthy(pool)) {
            return pool;
          }
        }
        return null;
        
      case 'recovery':
        // Check if primary is healthy for recovery
        const primaryPoolForRecovery = pools.find(p => p.id === dnsConfig.primary_pool_id);
        if (primaryPoolForRecovery && this.isPoolHealthy(primaryPoolForRecovery)) {
          return primaryPoolForRecovery;
        }
        return this.handleDnsFailover();
        
      default:
        return this.selectPoolRandom(pools);
    }
  }
  
  /**
   * Handle DNS failover logic
   */
  private async handleDnsFailover(): Promise<OriginPool | null> {
    if (!this.dnsState || !this.config.load_balancer.dns_failover) {
      return null;
    }
    
    const dnsConfig = this.config.load_balancer.dns_failover;
    
    // Increment failure count
    this.dnsState.failure_count++;
    
    // Check if we should trigger failover
    if (this.dnsState.failure_count >= dnsConfig.failure_threshold) {
      this.dnsState.failover_state = 'failover';
      this.dnsState.last_failover_time = Date.now();
      this.metrics.dnsFailovers = (this.metrics.dnsFailovers || 0) + 1;
      
      // Update DNS records to point to failover backends
      await this.updateDnsRecordsForFailover();
      
      // Find first healthy failover pool
      for (const poolId of dnsConfig.failover_pool_ids) {
        const pool = this.config.pools.find(p => p.id === poolId);
        if (pool && this.isPoolHealthy(pool)) {
          this.dnsState.current_pool_id = poolId;
          this.dnsState.current_backend_ips = pool.backends
            .filter(b => b.healthy && b.enabled)
            .map(b => b.ip);
          return pool;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Update DNS failover state based on health checks
   */
  private async updateDnsFailoverState(): Promise<void> {
    if (!this.dnsState || !this.config.load_balancer.dns_failover) {
      return;
    }
    
    const dnsConfig = this.config.load_balancer.dns_failover;
    const primaryPool = this.config.pools.find(p => p.id === dnsConfig.primary_pool_id);
    
    if (!primaryPool) return;
    
    const isPrimaryHealthy = this.isPoolHealthy(primaryPool);
    
    switch (this.dnsState.failover_state) {
      case 'primary':
        if (!isPrimaryHealthy) {
          await this.handleDnsFailover();
        }
        break;
        
      case 'failover':
        if (isPrimaryHealthy) {
          this.dnsState.failover_state = 'recovery';
          this.dnsState.recovery_count = 0;
        }
        break;
        
      case 'recovery':
        if (isPrimaryHealthy) {
          this.dnsState.recovery_count++;
          if (this.dnsState.recovery_count >= dnsConfig.recovery_threshold) {
            // Recovery successful, switch back to primary
            this.dnsState.failover_state = 'primary';
            this.dnsState.current_pool_id = dnsConfig.primary_pool_id;
            this.dnsState.current_backend_ips = primaryPool.backends
              .filter(b => b.healthy && b.enabled)
              .map(b => b.ip);
            this.dnsState.failure_count = 0;
            this.dnsState.recovery_count = 0;
            this.metrics.dnsRecoveries = (this.metrics.dnsRecoveries || 0) + 1;
            
            await this.updateDnsRecordsForRecovery();
          }
        } else {
          // Primary became unhealthy again during recovery
          this.dnsState.failover_state = 'failover';
          this.dnsState.recovery_count = 0;
        }
        break;
    }
  }
  
  /**
   * Select backend within a pool using endpoint steering
   */
  private async selectBackend(pool: OriginPool, request: Request, clientIp: string): Promise<Backend | null> {
    const healthyBackends = pool.backends.filter(b => b.healthy && b.enabled);
    if (healthyBackends.length === 0) {
      return null;
    }
    
    const steeringMethod = pool.endpoint_steering;
    
    switch (steeringMethod) {
      case 'random':
        return this.selectBackendRandom(healthyBackends);
        
      case 'round_robin':
        return this.selectBackendRoundRobin(healthyBackends);
        
      case 'hash':
        return this.selectBackendHash(healthyBackends, clientIp);
        
      case 'least_outstanding_requests':
        return this.selectBackendLeastOutstandingRequests(healthyBackends);
        
      case 'least_connections':
        return this.selectBackendLeastConnections(healthyBackends);
        
      default:
        return this.selectBackendRandom(healthyBackends);
    }
  }
  
  private selectBackendRandom(backends: Backend[]): Backend | null {
    if (backends.length === 0) return null;
    
    // Calculate total weight
    const totalWeight = backends.reduce((sum, backend) => sum + backend.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const backend of backends) {
      random -= backend.weight;
      if (random <= 0) {
        return backend;
      }
    }
    
    return backends[backends.length - 1];
  }
  
  private selectBackendRoundRobin(backends: Backend[]): Backend | null {
    if (backends.length === 0) return null;
    
    // Update round robin index
    this.config.currentRoundRobinIndex = (this.config.currentRoundRobinIndex + 1) % backends.length;
    return backends[this.config.currentRoundRobinIndex];
  }
  
  private selectBackendHash(backends: Backend[], clientIp: string): Backend | null {
    if (backends.length === 0) return null;
    
    // Simple hash function based on client IP
    const hash = this.hashString(clientIp);
    const index = hash % backends.length;
    return backends[index];
  }
  
  private selectBackendLeastOutstandingRequests(backends: Backend[]): Backend | null {
    if (backends.length === 0) return null;
    
    // Calculate scores based on weight and outstanding requests
    const backendScores: Array<{ backend: Backend; score: number }> = [];
    
    for (const backend of backends) {
      const outstandingRequests = backend.outstandingRequests || 0;
      // Transform weight: weight / (outstanding_requests + 1)
      const transformedWeight = backend.weight / (outstandingRequests + 1);
      backendScores.push({ backend, score: transformedWeight });
    }
    
    // Sort by score (higher is better)
    backendScores.sort((a, b) => b.score - a.score);
    
    // Use weighted random selection
    const totalScore = backendScores.reduce((sum, b) => sum + b.score, 0);
    let random = Math.random() * totalScore;
    
    for (const { backend, score } of backendScores) {
      random -= score;
      if (random <= 0) {
        return backend;
      }
    }
    
    return backendScores[0]?.backend || null;
  }
  
  private selectBackendLeastConnections(backends: Backend[]): Backend | null {
    if (backends.length === 0) return null;
    
    // Find backend with least active connections
    let minConnections = Infinity;
    const candidates: Backend[] = [];
    
    for (const backend of backends) {
      const connections = this.metrics.backendMetrics[backend.id]?.connectionsActive || 0;
      if (connections < minConnections) {
        minConnections = connections;
        candidates.length = 0;
        candidates.push(backend);
      } else if (connections === minConnections) {
        candidates.push(backend);
      }
    }
    
    // If multiple backends have same connection count, use random selection
    return this.selectBackendRandom(candidates);
  }
  
  /**
   * Utility functions
   */
  private isPoolHealthy(pool: OriginPool): boolean {
    const healthyBackends = pool.backends.filter(b => b.healthy && b.enabled);
    return healthyBackends.length >= pool.minimum_origins;
  }
  
  private getFallbackPool(): OriginPool | null {
    const fallbackPoolId = this.config.load_balancer.fallback_pool_id;
    if (!fallbackPoolId) return null;
    
    return this.config.pools.find(p => p.id === fallbackPoolId) || null;
  }
  
  private prepareResponseHeaders(backend: Backend, pool: OriginPool): Record<string, string> {
    const headers: Record<string, string> = {};
    
    if (this.config.observability.responseHeaderName) {
      headers[this.config.observability.responseHeaderName] = backend.id;
    }
    
    if (this.config.observability.add_backend_header) {
      headers['X-LB-Backend'] = backend.id;
    }
    
    if (this.config.observability.add_pool_header) {
      headers['X-LB-Pool'] = pool.id;
    }
    
    if (this.config.observability.add_region_header && backend.region) {
      headers['X-LB-Region'] = backend.region;
    }
    
    return headers;
  }
  
  private updateMetrics(backendId: string, poolId: string, startTime: number): void {
    const duration = Date.now() - startTime;
    
    // Update service metrics
    this.metrics.totalRequests++;
    this.metrics.totalSuccessfulRequests++;
    
    // Update backend metrics
    const backendMetrics = this.metrics.backendMetrics[backendId];
    if (backendMetrics) {
      backendMetrics.requests++;
      backendMetrics.successfulRequests++;
      backendMetrics.totalResponseTimeMs += duration;
      backendMetrics.avgResponseTimeMs = backendMetrics.totalResponseTimeMs / backendMetrics.requests;
      backendMetrics.lastRequestTimestamp = Date.now();
    }
    
    // Update pool metrics
    const poolMetrics = this.metrics.poolMetrics[poolId];
    if (poolMetrics) {
      poolMetrics.totalRequests++;
      poolMetrics.totalSuccessfulRequests++;
      poolMetrics.avgResponseTime = (poolMetrics.avgResponseTime * (poolMetrics.totalRequests - 1) + duration) / poolMetrics.totalRequests;
    }
  }
  
  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });
    
    return cookies;
  }
  
  private generateSessionKey(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
  
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
  
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    // Haversine formula for calculating distance between two points on Earth
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
  
  private async measurePoolRtt(pool: OriginPool, region: string): Promise<number> {
    // In a real implementation, this would measure actual RTT to pool endpoints
    // For now, return a simulated value based on region
    const baseRtt = 50; // Base RTT in ms
    const regionMultiplier = region === 'us-east' ? 1 : region === 'eu-west' ? 1.5 : 2;
    const randomFactor = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
    
    const rtt = baseRtt * regionMultiplier * randomFactor;
    
    // Cache the result
    if (!this.rttCache.has(pool.id)) {
      this.rttCache.set(pool.id, {});
    }
    this.rttCache.get(pool.id)![region] = rtt;
    
    return rtt;
  }
  
  private async updateDnsRecordsForFailover(): Promise<void> {
    // This would integrate with DNS API to update records
    console.log('[DNS] Failover triggered - updating DNS records to failover pool');
  }
  
  private async updateDnsRecordsForRecovery(): Promise<void> {
    // This would integrate with DNS API to update records back to primary
    console.log('[DNS] Recovery complete - updating DNS records back to primary pool');
  }
  
  /**
   * Public methods for external use
   */
  public getMetrics(): ServiceMetrics {
    return { ...this.metrics };
  }
  
  public getDnsState(): DnsState | null {
    return this.dnsState ? { ...this.dnsState } : null;
  }
  
  public async performHealthCheck(poolId?: string, backendId?: string): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    
    const poolsToCheck = poolId ? 
      this.config.pools.filter(p => p.id === poolId) : 
      this.config.pools;
    
    for (const pool of poolsToCheck) {
      const backendsToCheck = backendId ?
        pool.backends.filter(b => b.id === backendId) :
        pool.backends;
        
      for (const backend of backendsToCheck) {
        const result = await this.checkBackendHealth(pool.id, backend);
        results.push(result);
        this.healthCheckResults.set(`${pool.id}:${backend.id}`, result);
      }
    }
    
    return results;
  }
  
  private async checkBackendHealth(poolId: string, backend: Backend): Promise<HealthCheckResult> {
    const activeHealthCheck = this.config.activeHealthChecks;
    
    if (!activeHealthCheck?.enabled) {
      // If no active health check, assume healthy if backend is enabled
      return {
        poolId,
        backendId: backend.id,
        healthy: backend.enabled,
        timestamp: Date.now()
      };
    }
    
    try {
      const startTime = Date.now();
      const url = `${backend.url}${activeHealthCheck.path}`;
      
      const response = await fetch(url, {
        method: activeHealthCheck.method || 'GET',
        headers: activeHealthCheck.headers,
        signal: AbortSignal.timeout(activeHealthCheck.timeout * 1000)
      });
      
      const responseTime = Date.now() - startTime;
      const expectedCodes = activeHealthCheck.expected_codes || [200];
      const isHealthy = expectedCodes.includes(response.status);
      
      if (activeHealthCheck.expected_body) {
        const body = await response.text();
        const bodyMatches = body.includes(activeHealthCheck.expected_body);
        
        return {
          poolId,
          backendId: backend.id,
          healthy: isHealthy && bodyMatches,
          responseTime,
          statusCode: response.status,
          timestamp: Date.now()
        };
      }
      
      return {
        poolId,
        backendId: backend.id,
        healthy: isHealthy,
        responseTime,
        statusCode: response.status,
        timestamp: Date.now()
      };
      
    } catch (error) {
      return {
        poolId,
        backendId: backend.id,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
    }
  }
  
  public updateConfig(newConfig: LoadBalancerServiceConfig): void {
    this.config = newConfig;
    
    // Reinitialize DNS state if DNS failover was enabled/disabled
    if (newConfig.load_balancer.dns_failover?.enabled && !this.dnsState) {
      this.dnsState = this.initializeDnsState();
    } else if (!newConfig.load_balancer.dns_failover?.enabled) {
      this.dnsState = undefined;
    }
  }
  
  public enableDnsFailover(config: DnsFailoverConfig): void {
    this.config.load_balancer.dns_failover = config;
    this.dnsState = this.initializeDnsState();
  }
  
  public disableDnsFailover(): void {
    this.config.load_balancer.dns_failover = undefined;
    this.dnsState = undefined;
  }
} 