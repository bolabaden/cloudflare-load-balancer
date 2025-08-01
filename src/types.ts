// src/types.ts

export interface Backend {
	id: string;
	url: string;
	ip: string;
	weight: number;
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

export interface ObservabilityConfig {
	responseHeaderName?: string;
	add_backend_header?: boolean;
}

export interface SSLConfig {
	skipCertificateVerification?: boolean;
	allowSelfSignedCertificates?: boolean;
	skipHostnameVerification?: boolean;
}

export interface DnsFirstConfig {
	enabled: boolean;
	timeoutMs: number;
	failureStatusCodes: number[];
	maxResponseTimeMs: number;
}

export interface LoadBalancerServiceConfig {
	serviceId: string;
	simpleBackends?: string[];
	pools: OriginPool[];
	load_balancer: LoadBalancer;
	currentRoundRobinIndex: number;
	hostHeaderRewrite?: 'preserve' | 'backend_hostname' | string;
	observability: ObservabilityConfig;
	dnsFirst?: DnsFirstConfig;
	ssl?: SSLConfig;
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

// New types for JSON configuration format
export interface ServiceConfig {
	hostname: string;
	backends: string[];
}

export interface LoadBalancerConfig {
	services: ServiceConfig[];
}
