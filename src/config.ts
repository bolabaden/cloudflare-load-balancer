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

// Initialize default backends from environment variable
export async function initializeDefaultBackends(env: Env): Promise<void> {
	if (!env.DEFAULT_BACKENDS) return;
	
	const groups = parseDefaultBackends(env.DEFAULT_BACKENDS);
	
	for (const group of groups) {
		const { hostname, backends } = group;
		if (!hostname || backends.length === 0) continue;
		
		const config = {
			serviceId: hostname,
			backends: backends.map((url, index) => ({
				id: `backend-${index + 1}`,
				url: url,
				weight: 1,
				healthy: true,
				consecutiveFailures: 0,
				requests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				totalResponseTimeMs: 0,
				status: "Initialized"
			})),
			currentRoundRobinIndex: 0,
			sessionAffinity: {
				type: 'none' as const,
				enabled: false
			},
			passiveHealthChecks: {
				maxFailures: 2,
				failureTimeoutMs: 30000,
				retryableStatusCodes: [500, 502, 503, 504],
				enabled: true
			},
			activeHealthChecks: {
				enabled: true,
				path: '/',
				intervalMs: 30000,
				timeoutMs: 5000,
				expectedStatusCode: 200
			},
			retryPolicy: {
				maxRetries: 2,
				enabled: true,
				retryTimeoutMs: 5000
			},
			hostHeaderRewrite: 'preserve',
			observability: {
				responseHeaderName: 'X-CF-Backend-Used'
			}
		};
		
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
				if (!existingConfig.backends || existingConfig.backends.length === 0) {
					const configRequest = new Request('http://localhost/__lb_admin__/config', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(config)
					});
					await doStub.fetch(configRequest);
					console.log(`[Init] Initialized DO for ${hostname} with ${backends.length} backends from DEFAULT_BACKENDS`);
				} else {
					console.log(`[Init] DO for ${hostname} already has ${existingConfig.backends.length} backends configured, skipping initialization`);
				}
			} else {
				// No existing config, create new one
				const configRequest = new Request('http://localhost/__lb_admin__/config', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(config)
				});
				await doStub.fetch(configRequest);
				console.log(`[Init] Initialized DO for ${hostname} with ${backends.length} backends from DEFAULT_BACKENDS`);
			}
		} catch (error) {
			console.error(`[Init] Failed to initialize DO for ${hostname} from DEFAULT_BACKENDS:`, error);
		}
	}
} 
