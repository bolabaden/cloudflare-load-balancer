// src/types.ts

export interface Backend {
	id: string;
	url: string;
	ip: string;
	weight: number;
	healthy: boolean;
	lastFailureTimestamp?: number;
	consecutiveFailures: number;
	status?: string;
	priority: number;
	enabled: boolean;
	requests: number;
	successfulRequests: number;
	failedRequests: number;
	totalResponseTimeMs: number;
}

export interface OriginPool {
	id: string;
	name: string;
	backends: Backend[];
	enabled: boolean;
	minimum_origins: number;
	endpoint_steering: 'round_robin' | 'random' | 'hash';
}

export interface LoadBalancer {
	id: string;
	name: string;
	hostname: string;
	default_pool_ids: string[];
	proxied: boolean;
	enabled: boolean;
	steering_policy: 'off' | 'random' | 'geo' | 'dynamic';
	session_affinity: {
		type: 'none' | 'cookie' | 'ip_cookie';
		enabled: boolean;
		cookieName?: string;
		ttl?: number;
	};
}

export interface PassiveHealthCheckConfig {
	enabled: boolean;
	max_failures: number;
	failure_timeout_ms: number;
	retryable_status_codes: number[];
	monitor_timeout: number;
}

export interface ActiveHealthCheckConfig {
	enabled: boolean;
	type: 'http' | 'https' | 'tcp';
	path: string;
	method?: string;
	timeout: number;
	interval: number;
	retries: number;
	expected_codes?: number[];
	expected_body?: string;
	follow_redirects?: boolean;
	consecutive_up: number;
	consecutive_down: number;
	headers?: { [key: string]: string };
}

export interface RetryPolicyConfig {
	max_retries: number;
	retry_timeout: number;
	backoff_strategy: 'constant' | 'exponential';
	base_delay: number;
}

export interface ObservabilityConfig {
	responseHeaderName?: string;
	add_backend_header?: boolean;
}

export interface LoadBalancerServiceConfig {
	serviceId: string;
	mode?: 'simple' | 'advanced';
	simpleBackends?: string[];
	pools: OriginPool[];
	load_balancer: LoadBalancer;
	currentRoundRobinIndex: number;
	passiveHealthChecks: PassiveHealthCheckConfig;
	activeHealthChecks: ActiveHealthCheckConfig;
	retryPolicy: RetryPolicyConfig;
	hostHeaderRewrite?: 'preserve' | 'backend_hostname' | string;
	observability: ObservabilityConfig;
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
	backendMetrics: Record<string, BackendMetrics>;
	poolMetrics: Record<string, any>;
}

export interface StoredState {
	config: LoadBalancerServiceConfig;
	metrics?: ServiceMetrics;
} 