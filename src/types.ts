// src/types.ts

export interface Backend {
  id: string; // Unique identifier for the backend (e.g., its URL or a custom ID)
  url: string; // Full URL to the backend server, e.g., "https://aiostreams-cf.bolabaden.org"
  weight: number; // For weighted round-robin, default 1
  healthy: boolean; // Current health status
  lastFailureTimestamp?: number; // Timestamp of the last detected failure
  consecutiveFailures: number; // Count of consecutive failures
  status?: string; // Optional: more detailed status message
  // Metrics specific to this backend could also be nested here or kept separate
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  totalResponseTimeMs: number;
}

export interface SessionAffinityConfig {
  type: 'none' | 'cookie' | 'ip';
  cookieName?: string; // e.g., "X-Backend-Affinity"
  cookieTTLSeconds?: number; // TTL for the affinity cookie
}

export interface PassiveHealthCheckConfig {
  maxFailures: number; // Max consecutive failures before marking unhealthy
  failureTimeoutMs: number; // How long a backend stays unhealthy after maxFailures
  retryableStatusCodes: number[]; // e.g., [500, 502, 503, 504]
}

export interface ActiveHealthCheckConfig {
  enabled: boolean;
  path: string; // e.g., "/healthz"
  intervalMs: number;
  timeoutMs: number;
  expectedStatusCode?: number; // Default 200
  expectedResponseBody?: string; // Optional: to match against response body
}

export interface RetryPolicyConfig {
  maxRetries: number; // Max retries for a request if a backend fails
  // retryableStatusCodes are part of PassiveHealthCheckConfig for backend failure detection
}

export interface LoadBalancerServiceConfig {
  serviceId: string; // e.g., "aiostreams.bolabaden.org" or "default"
  backends: Backend[];
  currentRoundRobinIndex: number;
  sessionAffinity: SessionAffinityConfig;
  passiveHealthChecks: PassiveHealthCheckConfig;
  activeHealthChecks?: ActiveHealthCheckConfig; // Optional
  retryPolicy: RetryPolicyConfig;
  hostHeaderRewrite: 'preserve' | 'backend_hostname' | string; // 'preserve', 'backend_hostname', or a specific string
  observability: {
    responseHeaderName?: string; // e.g., "X-Backend-Used"
  };
}

// For Durable Object storage
export interface StoredState {
  config: LoadBalancerServiceConfig;
  // Metrics might be stored separately or as part of config for simplicity if not too large
  // For more complex metrics, a separate key or even another DO/KV might be better.
  // For now, let's assume metrics are managed in-memory and periodically flushed or part of `Backend` state.
}

export interface BackendMetrics {
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  totalResponseTimeMs: number;
  avgResponseTimeMs: number;
  lastRequestTimestamp?: number;
  lastSuccessTimestamp?: number;
  lastFailureTimestamp?: number;
}

export interface ServiceMetrics {
  serviceId: string;
  totalRequests: number;
  totalSuccessfulRequests: number;
  totalFailedRequests: number;
  backendMetrics: Record<string, BackendMetrics>; // Keyed by backend ID
}

// API request/response types
export interface UpdateServiceConfigRequest {
  // Allows partial updates to the service configuration
  serviceId?: string; // if updating a specific service via a general admin DO
  backends?: Partial<Backend>[]; // Can send partial updates or full list to replace
  currentRoundRobinIndex?: number;
  sessionAffinity?: Partial<SessionAffinityConfig>;
  passiveHealthChecks?: Partial<PassiveHealthCheckConfig>;
  activeHealthChecks?: Partial<ActiveHealthCheckConfig>;
  retryPolicy?: Partial<RetryPolicyConfig>;
  hostHeaderRewrite?: 'preserve' | 'backend_hostname' | string;
  observability?: {
    responseHeaderName?: string;
  };
} 