// Configuration and initialization utilities

// Parse DEFAULT_BACKENDS from JSON format
// Format: {"services": [{"hostname": "example.com", "backends": ["https://backend1.com", "https://backend2.com"]}]}
export function parseDefaultBackends(defaultBackends: string): Array<{hostname: string, backends: string[]}> {
	if (!defaultBackends) return [];
	
	try {
		const config = JSON.parse(defaultBackends);
		
		// Support both array format and object format
		if (Array.isArray(config)) {
			// Direct array format: [{"hostname": "...", "backends": [...]}]
			return config.filter((service: any) => 
				service.hostname && 
				Array.isArray(service.backends) && 
				service.backends.length > 0
			);
		} else if (config.services && Array.isArray(config.services)) {
			// Object format: {"services": [{"hostname": "...", "backends": [...]}]}
			return config.services.filter((service: any) => 
				service.hostname && 
				Array.isArray(service.backends) && 
				service.backends.length > 0
			);
		} else if (config.hostname && Array.isArray(config.backends)) {
			// Single service format: {"hostname": "...", "backends": [...]}
			return [config];
		}
		
		return [];
	} catch (error) {
		console.error('Failed to parse DEFAULT_BACKENDS JSON:', error);
		return [];
	}
}

/**
 * Smart health check path detection
 * Tries common health check endpoints in order of preference
 */
export const COMMON_HEALTH_PATHS = [
	'/health',
	'/healthz', 
	'/health-check',
	'/status',
	'/ping',
	'/api/health',
	'/api/healthz',
	'/api/status',
	'/_health',
	'/.well-known/health-check',
	'/' // Last resort - root path
];

/**
 * Intelligent defaults for load balancer configuration
 * These defaults are designed to "just work" for 80% of use cases
 */
export function createSmartDefaults(hostname: string, backends: string[]) {
	return {
		serviceId: hostname,
		mode: 'simple',
		simpleBackends: backends,
		pools: [{
			id: "simple-pool",
			name: "Primary Pool",
			backends: backends.map((url: string, index: number) => ({
				id: `backend-${index + 1}`,
				url: url,
				ip: new URL(url).hostname,
				weight: 1,
				healthy: true,
				consecutiveFailures: 0,
				requests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				totalResponseTimeMs: 0,
				priority: 10 + index, // Slight priority difference for ordering
				enabled: true
			})),
			enabled: true,
			minimum_origins: 1,
			endpoint_steering: 'round_robin'
		}],
		load_balancer: {
			id: `lb-${hostname.replace(/[^a-zA-Z0-9]/g, '-')}`,
			name: `Load Balancer for ${hostname}`,
			hostname: hostname,
			default_pool_ids: ["simple-pool"],
			proxied: true,
			enabled: true,
			steering_policy: "off", // Simple failover for most use cases
			session_affinity: {
				type: "none",
				enabled: false // Keep it simple by default
			},
			// Enable zero-downtime failover by default for reliability
			zero_downtime_failover: {
				enabled: true,
				policy: 'temporary',
				trigger_codes: [521, 522, 523, 525, 526], // Cloudflare error codes
				max_retries: 2, // Conservative retry count
				retry_delay_ms: 500, // Quick retry
				adaptive_routing: true
			}
		},
		currentRoundRobinIndex: 0,
		
		// Smart passive health checks - enabled by default with sensible settings
		passiveHealthChecks: { 
			enabled: true,
			max_failures: 2, // Fail fast
			failure_timeout_ms: 30000, // 30 seconds
			retryable_status_codes: [500, 502, 503, 504, 521, 522, 523, 525, 526], 
			monitor_timeout: 10,
			// Circuit breaker for reliability
			circuit_breaker: {
				enabled: true,
				failure_threshold: 3, // Open circuit after 3 failures
				recovery_timeout_ms: 60000, // 1 minute recovery
				success_threshold: 2, // 2 successes to close circuit
				error_rate_threshold: 50, // 50% error rate threshold
				min_requests: 5 // Minimum requests before calculating error rate
			},
			connection_error_handling: {
				immediate_failover: true, // Fail fast on connection errors
				max_connection_retries: 1, // Single retry to keep things fast
				connection_timeout_ms: 10000, // 10 second timeout
				retry_backoff_ms: 1000 // 1 second backoff
			},
			health_scoring: {
				enabled: true,
				response_time_weight: 0.3,
				error_rate_weight: 0.4,
				availability_weight: 0.3,
				time_window_ms: 300000 // 5 minute window
			}
		},
		
		// Smart active health checks - enabled by default with intelligent path detection
		activeHealthChecks: { 
			enabled: true, // Enable by default for better reliability
			type: 'http',
			path: "/health", // Will be smartly detected on first health check
			method: 'GET',
			interval: 60, // Every minute
			timeout: 5, // 5 second timeout
			consecutive_up: 2, // 2 consecutive successes to mark healthy
			consecutive_down: 2, // 2 consecutive failures to mark unhealthy
			retries: 1, // Single retry
			expected_codes: [200, 204] // Common success codes
		},
		
		// Conservative retry policy
		retryPolicy: { 
			enabled: true,
			max_retries: 1, // Single retry to keep response times low
			retry_timeout: 5000, // 5 second timeout per retry
			backoff_strategy: 'constant', // Simple constant backoff
			base_delay: 1000 // 1 second delay
		},
		
		// Preserve host headers by default (most common need)
		hostHeaderRewrite: 'preserve',
		
		// Simple observability
		observability: { 
			responseHeaderName: "X-Backend-Used",
			add_backend_header: true,
			add_pool_header: false, // Keep headers minimal
			add_region_header: false
		}
	};
}

/**
 * Detect the best health check path for a backend
 * This function will try common health check paths and return the first working one
 */
export async function detectHealthCheckPath(backendUrl: string): Promise<string> {
	const baseUrl = new URL(backendUrl);
	
	for (const path of COMMON_HEALTH_PATHS) {
		try {
			const healthUrl = new URL(path, baseUrl).toString();
			const response = await fetch(healthUrl, {
				method: 'GET',
				headers: {
					'User-Agent': 'FlowBalance-HealthCheck/1.0'
				},
				signal: AbortSignal.timeout(5000) // 5 second timeout
			});
			
			// Accept any 2xx or 3xx response as valid health endpoint
			if (response.status >= 200 && response.status < 400) {
				console.log(`[HealthCheck] Found working health endpoint for ${backendUrl}: ${path}`);
				return path;
			}
		} catch (error) {
			// Continue to next path on error
			continue;
		}
	}
	
	console.log(`[HealthCheck] No working health endpoint found for ${backendUrl}, using /health as fallback`);
	return '/health'; // Fallback to default
}

// Initialize default backends from environment variable
export async function initializeDefaultBackends(env: Env): Promise<void> {
	if (!env.DEFAULT_BACKENDS) return;
	
	const groups = parseDefaultBackends(env.DEFAULT_BACKENDS);
	
	for (const group of groups) {
		const { hostname, backends } = group;
		if (!hostname || backends.length === 0) continue;
		
		// Use smart defaults
		const config = createSmartDefaults(hostname, backends);
		
		try {
			const doId = env.LOAD_BALANCER_DO.idFromName(hostname);
			const doStub = env.LOAD_BALANCER_DO.get(doId);
			
			// Check if configuration already exists to avoid overwriting
			const checkRequest = new Request('http://localhost/__lb_admin__/config', {
				method: 'GET',
				headers: { 'Content-Type': 'application/json' }
			});
			const existingConfigResponse = await doStub.fetch(checkRequest);
			
			if (existingConfigResponse.ok) {
				const existingConfig = await existingConfigResponse.json() as any;
				// Only initialize if no backends are configured or if backends are empty
				if (!existingConfig.backends && (!existingConfig.pools || existingConfig.pools.length === 0 || existingConfig.pools[0].backends.length === 0)) {
					const configRequest = new Request('http://localhost/__lb_admin__/config', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(config)
					});
					await doStub.fetch(configRequest);
					console.log(`[Init] ✅ Initialized ${hostname} with ${backends.length} backends using smart defaults`);
				} else {
					const backendCount = existingConfig.pools ? existingConfig.pools.reduce((count: number, pool: any) => count + (pool.backends?.length || 0), 0) : existingConfig.backends?.length || 0;
					console.log(`[Init] ⏭️ ${hostname} already configured with ${backendCount} backends, skipping initialization`);
				}
			} else {
				// No existing config, create new one
				const configRequest = new Request('http://localhost/__lb_admin__/config', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(config)
				});
				await doStub.fetch(configRequest);
				console.log(`[Init] 🚀 Created new service ${hostname} with ${backends.length} backends using smart defaults`);
			}
		} catch (error) {
			console.error(`[Init] ❌ Failed to initialize ${hostname}:`, error);
		}
	}
} 
