// src/types.ts

export interface Backend {
  id: string; // Unique identifier for the backend (e.g., its URL or a custom ID)
  url: string; // Full URL to the backend server, e.g., "https://aiostreams-cf.bolabaden.org"
  ip: string; // IP address of the backend for DNS-based load balancing
  weight: number; // For weighted round-robin, default 1
  healthy: boolean; // Current health status
  lastFailureTimestamp?: number; // Timestamp of the last detected failure
  consecutiveFailures: number; // Count of consecutive failures
  status?: string; // Optional: more detailed status message
  priority: number; // Priority for failover (lower = higher priority)
  enabled: boolean; // Whether this backend is enabled for traffic
  
  // Geolocation data for proximity steering
  latitude?: number;
  longitude?: number;
  region?: string; // e.g., "us-east", "eu-west", "apac"
  
  // Health check specific data
  responseTime?: number; // Last response time in ms
  
  // Metrics specific to this backend
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  totalResponseTimeMs: number;
  outstandingRequests?: number; // For LORS algorithm
  
  // NEW: Enhanced error tracking and circuit breaker state
  circuitBreakerState?: 'closed' | 'open' | 'half-open';
  circuitBreakerOpenTimestamp?: number;
  consecutiveSuccesses?: number; // Track consecutive successes for recovery
  lastSuccessTimestamp?: number;
  errorCounts?: {
    connection: number;
    timeout: number;
    http5xx: number;
    http523: number; // Specifically track 523 errors
  };
  avgResponseTimeMs?: number; // Rolling average response time
  healthScore?: number; // 0-100 health score based on multiple factors
}

export interface OriginPool {
  id: string;
  name: string;
  description?: string;
  backends: Backend[];
  enabled: boolean;
  minimum_origins: number; // Minimum healthy origins to consider pool healthy
  notification_email?: string;
  latitude?: number; // For proximity steering
  longitude?: number;
  
  // Endpoint steering method for origins within this pool
  endpoint_steering: EndpointSteeringMethod;
  
  // Load shedding configuration
  load_shedding?: {
    default_policy?: 'none' | 'shed_new' | 'shed_new_and_existing';
    session_affinity_policy?: 'honor' | 'shed';
  };
}

export interface LoadBalancer {
  id: string;
  name: string;
  description?: string;
  hostname: string; // The DNS hostname for this load balancer
  fallback_pool_id?: string;
  default_pool_ids: string[]; // Array of pool IDs in priority order
  proxied: boolean; // True for Layer 7, false for DNS-only
  enabled: boolean;
  
  // Traffic steering method for selecting between pools
  steering_policy: TrafficSteeringMethod;
  
  // Session affinity configuration
  session_affinity?: SessionAffinityConfig;
  
  // DNS-based failover configuration
  dns_failover?: DnsFailoverConfig;
  
  // Region pools for geo-steering
  region_pools?: { [region: string]: string[] }; // region -> pool IDs
  
  // Country pools for geo-steering  
  country_pools?: { [country: string]: string[] }; // country code -> pool IDs
  
  // Pop pools for proximity steering
  pop_pools?: { [pop: string]: string[] }; // PoP code -> pool IDs
  
  // Adaptive routing settings
  adaptive_routing?: AdaptiveRoutingConfig;
  
  // Zero-downtime failover
  zero_downtime_failover?: ZeroDowntimeFailoverConfig;
  
  // Custom rules
  rules?: LoadBalancerRule[];
  
  // TTL for DNS responses (for DNS-only load balancers)
  ttl?: number;
}

export type TrafficSteeringMethod = 
  | 'off' // Failover only
  | 'random' // Random with weights
  | 'geo' // Geographic steering
  | 'dynamic' // Dynamic latency-based steering
  | 'proximity' // Proximity-based steering  
  | 'least_outstanding_requests' // LORS
  | 'least_connections'
  | 'dns_failover'; // NEW: DNS-based failover mode

export type EndpointSteeringMethod =
  | 'random' // Random with weights
  | 'hash' // IP hash-based sticky
  | 'least_outstanding_requests' // LORS
  | 'least_connections'
  | 'round_robin'; // Traditional round-robin

export interface SessionAffinityConfig {
  type: 'none' | 'cookie' | 'ip_cookie' | 'header';
  enabled?: boolean; // Whether session affinity is enabled
  ttl?: number; // Session TTL in seconds
  cookieName?: string; // e.g., "X-Backend-Affinity"
  cookie_attributes?: {
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
  };
  header_name?: string; // For header-based affinity
  zero_downtime_failover?: 'none' | 'temporary' | 'sticky';
  drain_duration?: number; // Endpoint draining duration in seconds
}

export interface DnsFailoverConfig {
  enabled: boolean;
  primary_pool_id: string;
  failover_pool_ids: string[]; // Ordered list of failover pools
  health_check_interval: number; // How often to check health (seconds)
  failure_threshold: number; // Number of failures before failover
  recovery_threshold: number; // Number of successes before recovery
  dns_ttl: number; // TTL for DNS records during failover
  update_method: 'immediate' | 'gradual'; // How to update DNS records
  dns_record_name: string; // The DNS record name to update (e.g., "api.example.com")
  
  // Cloudflare API configuration for DNS record management
  zone_id?: string; // Cloudflare Zone ID for the domain
  api_token?: string; // Cloudflare API token with DNS write permissions
  
  // Enhanced DNS management options
  webhook_url?: string; // Optional webhook URL for DNS change notifications
}

export interface AdaptiveRoutingConfig {
  failover_across_pools: boolean;
}

export interface ZeroDowntimeFailoverConfig {
  enabled: boolean;
  policy: 'none' | 'temporary' | 'sticky';
  
  // NEW: Enhanced zero-downtime failover for specific error codes
  trigger_codes?: number[]; // Error codes that trigger zero-downtime failover (default: [521, 522, 523, 525, 526])
  max_retries?: number; // Maximum retries per request
  retry_delay_ms?: number; // Delay between retries
  fallback_pool_id?: string; // Specific pool to use for failover
  adaptive_routing?: boolean; // Enable adaptive routing based on backend health
}

export interface LoadBalancerRule {
  id: string;
  name: string;
  condition: string; // Expression for matching requests
  action: RuleAction;
  priority: number; // Lower = higher priority
  enabled: boolean;
}

export interface RuleAction {
  type: 'fixed_response' | 'forward' | 'redirect' | 'rewrite';
  
  // For fixed_response
  status_code?: number;
  content_type?: string;
  content?: string;
  headers?: Record<string, string>;
  
  // For forward
  pool_id?: string;
  
  // For redirect
  url?: string;
  status_code_redirect?: number;
  preserve_query_string?: boolean;
  
  // For rewrite
  url_rewrite?: string;
  path_rewrite?: string;
  host_rewrite?: string;
  
  // Session affinity overrides
  session_affinity_ttl?: number;
  session_affinity_enabled?: boolean;
}

// Action response types for rule execution
export interface FixedResponseAction extends Error {
  name: 'FixedResponseAction';
  response: {
    status: number;
    contentType: string;
    content: string;
    headers: Record<string, string>;
  };
}

export interface RedirectAction extends Error {
  name: 'RedirectAction';
  response: {
    url: string;
    status: number;
    preserveQuery: boolean;
    headers: Record<string, string>;
  };
}

export interface PassiveHealthCheckConfig {
  enabled: boolean;
  max_failures: number; // Max consecutive failures before marking unhealthy
  failure_timeout_ms: number; // How long a backend stays unhealthy after maxFailures
  retryable_status_codes: number[]; // e.g., [500, 502, 503, 504]
  monitor_timeout: number; // Timeout for health checks in seconds
  
  // NEW: Enhanced error handling configuration
  circuit_breaker?: {
    enabled: boolean;
    failure_threshold: number; // Number of failures to open circuit
    recovery_timeout_ms: number; // Time to wait before trying half-open
    success_threshold: number; // Consecutive successes needed to close circuit
    error_rate_threshold?: number; // Error rate % to open circuit (0-100)
    min_requests?: number; // Minimum requests before calculating error rate
  };
  
  // NEW: Specific handling for connection errors and 523s
  connection_error_handling?: {
    immediate_failover: boolean; // Immediately try next backend on connection errors
    max_connection_retries: number; // Max retries for connection errors
    connection_timeout_ms: number; // Connection timeout
    retry_backoff_ms: number; // Backoff between connection retries
  };
  
  // NEW: Health scoring system
  health_scoring?: {
    enabled: boolean;
    response_time_weight: number; // 0-1, weight for response time in health score
    error_rate_weight: number; // 0-1, weight for error rate in health score
    availability_weight: number; // 0-1, weight for availability in health score
    time_window_ms: number; // Time window for calculating health metrics
  };
}

export interface ActiveHealthCheckConfig {
  enabled: boolean;
  type: 'http' | 'https' | 'tcp' | 'udp_icmp' | 'icmp' | 'smtp' | 'ldap';
  path: string; // e.g., "/healthz"
  method?: string; // HTTP method for HTTP checks
  timeout: number; // Timeout in seconds
  interval: number; // Check interval in seconds
  retries: number; // Number of retries before marking unhealthy
  expected_codes?: number[]; // Expected HTTP status codes
  expected_body?: string; // Expected response body content
  follow_redirects?: boolean;
  allow_insecure?: boolean; // Allow self-signed certificates
  consecutive_up: number; // Consecutive successes needed to mark healthy
  consecutive_down: number; // Consecutive failures needed to mark unhealthy
  
  // Headers to send with health check
  headers?: { [key: string]: string };
  
  // Regions to probe from
  check_regions?: string[]; // e.g., ['WEU', 'EEU', 'NAM']
}

export interface RetryPolicyConfig {
  max_retries: number;
  retry_timeout: number;
  backoff_strategy: 'constant' | 'exponential';
  base_delay: number;
}

export interface ObservabilityConfig {
  responseHeaderName?: string; // e.g., "X-Backend-Used"
  add_backend_header?: boolean;
  add_pool_header?: boolean;
  add_region_header?: boolean;
}

// Notification system types
export interface NotificationConfig {
  id?: string;
  type: 'webhook' | 'email' | 'slack' | 'discord' | 'teams' | 'pagerduty' | 'opsgenie';
  enabled: boolean;
  name?: string;
  description?: string;
  
  // Common fields
  webhook_url?: string;
  secret?: string;
  
  // Email specific
  address?: string;
  
  // Service-specific authentication
  api_key?: string; // For OpsGenie, DataDog, etc.
  integration_key?: string; // For PagerDuty
  
  // Metadata for Cloudflare-style notifications
  account_id?: string;
  zone_id?: string;
  
  // Filtering options
  alert_types?: string[]; // Which alert types to send
  severity_levels?: string[]; // Which severity levels to send
}

export interface NotificationPayload {
  alert_id: string;
  alert_type: string;
  severity: string;
  message: string;
  timestamp: string;
  service_id: string;
  resolved: boolean;
  resolved_timestamp: string | null;
  metadata: {
    [key: string]: any;
    service_hostname: string;
    account_id: string;
    zone_id: string;
  };
}

export interface LoadBalancerServiceConfig {
  serviceId: string; // The hostname this service handles
  mode?: 'simple' | 'advanced'; // Mode selector - simple for basic failover, advanced for full features
  
  // Simple mode configuration (original functionality)
  simpleBackends?: string[]; // List of backend URLs for simple failover
  
  // Advanced mode configuration (Cloudflare-like features)
  pools: OriginPool[];
  load_balancer: LoadBalancer;
  
  // Common configuration
  currentRoundRobinIndex: number;
  backendCurrentWeights?: { [backendId: string]: number }; // For Smooth Weighted Round-Robin algorithm
  passiveHealthChecks: PassiveHealthCheckConfig;
  activeHealthChecks: ActiveHealthCheckConfig;
  retryPolicy: RetryPolicyConfig;
  hostHeaderRewrite?: 'preserve' | 'backend_hostname' | string;
  observability: ObservabilityConfig;
  
  // Session persistence
  sessionPersistence?: {
    enabled: boolean;
    method: 'cookie' | 'ip' | 'header';
    cookieName?: string;
    headerName?: string;
    ttl?: number; // Time to live in seconds
  };
  
  // Traffic steering
  trafficSteering?: {
    policy: 'weighted' | 'geo' | 'random' | 'least_connections' | 'least_response_time';
    geoRouting?: {
      [region: string]: string; // region -> pool ID mapping
    };
  };
  
  // Rate limiting
  rateLimiting?: {
    enabled: boolean;
    requestsPerMinute: number;
    burstSize?: number;
  };
  
  // Custom rules
  customRules?: {
    id: string;
    name: string;
    expression: string; // e.g., "http.request.uri.path contains '/api'"
    action: 'route' | 'block' | 'challenge';
    poolId?: string; // For route action
    priority: number;
  }[];
  
  // Notification settings
  notificationSettings?: NotificationConfig[];
}

// Enhanced metrics with more granular data
export interface BackendMetrics {
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  totalResponseTimeMs: number;
  avgResponseTimeMs: number;
  lastRequestTimestamp?: number;
  lastSuccessTimestamp?: number;
  lastFailureTimestamp?: number;
  
  // Advanced metrics
  p50ResponseTime?: number;
  p95ResponseTime?: number;
  p99ResponseTime?: number;
  connectionsActive?: number;
  connectionsTotal?: number;
  bytesIn?: number;
  bytesOut?: number;
  
  // Health check metrics
  healthCheckSuccess?: number;
  healthCheckFailure?: number;
  healthCheckLastSuccess?: number;
  healthCheckLastFailure?: number;
}

export interface PoolMetrics {
  poolId: string;
  totalRequests: number;
  totalSuccessfulRequests: number;
  totalFailedRequests: number;
  activeConnections: number;
  avgResponseTime: number;
  healthyOrigins: number;
  totalOrigins: number;
  lastToggle?: number; // Last time pool was enabled/disabled
}

export interface ServiceMetrics {
  serviceId: string;
  totalRequests: number;
  totalSuccessfulRequests: number;
  totalFailedRequests: number;
  backendMetrics: Record<string, BackendMetrics>; // Keyed by backend ID
  poolMetrics: Record<string, PoolMetrics>; // Keyed by pool ID
  
  // DNS failover metrics
  dnsFailovers?: number;
  dnsRecoveries?: number;
  currentDnsRecord?: string;
  
  // Steering metrics
  steeringDecisions?: {
    [method: string]: number; // Count of decisions by steering method
  };
  
  // Session affinity metrics
  sessionAffinityHits?: number;
  sessionAffinityMisses?: number;
}

// For Durable Object storage
export interface StoredState {
  config: LoadBalancerServiceConfig;
  metrics?: ServiceMetrics; // Optional cached metrics
  dns_state?: DnsState; // State for DNS-based load balancing
}

export interface DnsState {
  current_pool_id: string;
  current_backend_ips: string[];
  failover_state: 'primary' | 'failover' | 'recovery';
  last_failover_time?: number;
  failure_count: number;
  recovery_count: number;
  health_check_results: { [poolId: string]: HealthCheckResult };
  
  // Additional properties for enhanced DNS failover
  currentPool: string; // Alias for current_pool_id for compatibility
  lastFailoverTime?: number; // Alias for last_failover_time
  lastRecoveryTime?: number;
  failoverActive: boolean;
}

export interface HealthCheckResult {
  poolId: string;
  backendId: string;
  healthy: boolean;
  responseTime?: number;
  statusCode?: number;
  error?: string;
  timestamp: number;
}

// API request/response types
export interface UpdateServiceConfigRequest {
  // Allows partial updates to the service configuration
  serviceId?: string; // if updating a specific service via a general admin DO
  pools?: Partial<OriginPool>[]; // Can send partial updates or full list to replace
  load_balancer?: Partial<LoadBalancer>;
  currentRoundRobinIndex?: number;
  passiveHealthChecks?: Partial<PassiveHealthCheckConfig>;
  activeHealthChecks?: Partial<ActiveHealthCheckConfig>;
  retryPolicy?: Partial<RetryPolicyConfig>;
  hostHeaderRewrite?: 'preserve' | 'backend_hostname' | string;
  observability?: {
    responseHeaderName?: string;
    add_backend_header?: boolean;
    add_pool_header?: boolean;
    add_region_header?: boolean;
  };
}

// Configuration request interface that supports multiple input formats
export interface ConfigurationUpdateRequest extends Partial<LoadBalancerServiceConfig> {
  // PowerShell script format support
  backends?: Array<{
    url: string;
    weight?: number;
    healthy?: boolean;
  }>;
  
  healthCheck?: {
    active?: {
      enabled?: boolean;
      path?: string;
      interval?: number; // in milliseconds
      timeout?: number; // in milliseconds
      expectedStatus?: number;
    };
    passive?: {
      enabled?: boolean;
      failureThreshold?: number;
      recoveryThreshold?: number;
    };
  };
  
  sessionAffinity?: {
    enabled?: boolean;
    method?: string;
    cookieName?: string;
  };
}

export interface CreateLoadBalancerRequest {
  name: string;
  description?: string;
  hostname: string;
  pools: OriginPool[];
  fallback_pool_id?: string;
  default_pool_ids: string[];
  steering_policy: TrafficSteeringMethod;
  session_affinity?: SessionAffinityConfig;
  dns_failover?: DnsFailoverConfig;
  proxied?: boolean;
  ttl?: number;
}

export interface HealthCheckRequest {
  poolId?: string;
  backendId?: string;
  force?: boolean; // Force immediate health check
}

export interface AnalyticsRequest {
  serviceId?: string;
  since?: number; // Unix timestamp
  until?: number; // Unix timestamp
  metrics?: string[]; // Which metrics to include
  step?: number; // Aggregation step in seconds
}

export interface AnalyticsResponse {
  timeseries: {
    timestamp: number;
    requests: number;
    errors: number;
    response_time: number;
  }[];
  totals: {
    requests: number;
    errors: number;
    avg_response_time: number;
    availability: number;
  };
  pools: { [poolId: string]: PoolMetrics };
  backends: { [backendId: string]: BackendMetrics };
}

// Monitoring and alerting types
export interface Alert {
  id: string;
  type: 'backend_down' | 'pool_down' | 'high_latency' | 'high_error_rate' | 'dns_failover' | 'dns_failover_triggered' | 'dns_failover_error' | 'dns_recovery_completed' | 'dns_recovery_error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  resolved?: boolean;
  resolved_timestamp?: number;
  metadata?: Record<string, any>;
}

export interface AlertRule {
  id: string;
  name: string;
  type: Alert['type'];
  enabled: boolean;
  conditions: {
    threshold: number;
    duration: number; // seconds
    comparison: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  };
  actions: {
    email?: string[];
    webhook?: string;
    slack?: string;
  };
}

// Geographic and network data
export interface GeographicData {
  country: string;
  region: string;
  city?: string;
  latitude: number;
  longitude: number;
  asn?: number;
  timezone?: string;
  isp?: string;
}

export interface NetworkPath {
  hops: number;
  latency: number;
  packet_loss?: number;
  bandwidth?: number;
  last_measured: number;
}

// Custom middleware types
export interface Middleware {
  id: string;
  name: string;
  type: 'auth' | 'rate_limit' | 'transform' | 'logging' | 'custom';
  enabled: boolean;
  config: Record<string, any>;
  order: number;
}

// Cache and CDN integration
export interface CacheConfig {
  enabled: boolean;
  ttl: number;
  vary_headers?: string[];
  cache_key_pattern?: string;
  bypass_rules?: string[];
}

export interface ServiceDashboard {
  service: LoadBalancerServiceConfig;
  metrics: ServiceMetrics;
  pools: PoolDashboard[];
  healthStatus: {
    healthy: number;
    unhealthy: number;
    total: number;
  };
  recentEvents?: {
    timestamp: number;
    type: 'backend_down' | 'backend_up' | 'config_change' | 'health_check_failed';
    message: string;
  }[];
}

export interface PoolDashboard {
  pool: OriginPool;
  backends: BackendDashboard[];
  metrics: {
    totalRequests: number;
    successRate: number;
    avgResponseTime: number;
  };
}

export interface BackendDashboard {
  backend: Backend;
  metrics: BackendMetrics;
  healthHistory?: {
    timestamp: number;
    healthy: boolean;
    responseTime?: number;
  }[];
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  message: string;
  category: 'request' | 'health' | 'config' | 'error' | 'system' | 'alert';
  metadata?: {
    requestId?: string;
    backendId?: string;
    poolId?: string;
    statusCode?: number;
    responseTime?: number;
    clientIp?: string;
    userAgent?: string;
    [key: string]: any;
  };
}

// Expression parser types for rule evaluation
export interface Token {
  type: 'string' | 'number' | 'operator' | 'keyword' | 'identifier';
  value: any;
} 