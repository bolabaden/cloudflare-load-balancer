// Configuration and initialization utilities

// Initialize default backends from environment variable
export async function initializeDefaultBackends(env: Env): Promise<void> {
	if (!env.DEFAULT_BACKENDS) return;
	
	const entries = env.DEFAULT_BACKENDS.split(',');
	for (const entry of entries) {
		const [hostname, ...backends] = entry.split('|');
		if (hostname && backends.length > 0) {
			const trimmedHostname = hostname.trim();
			const config = {
				serviceId: trimmedHostname,
				backends: backends.map((url, index) => ({
					id: `backend-${index + 1}`,
					url: url.trim(),
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
				const doId = env.LOAD_BALANCER_DO.idFromName(trimmedHostname);
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
						console.log(`[Init] Initialized DO for ${trimmedHostname} with ${backends.length} backends from DEFAULT_BACKENDS`);
					} else {
						console.log(`[Init] DO for ${trimmedHostname} already has ${existingConfig.backends.length} backends configured, skipping initialization`);
					}
				} else {
					// No existing config, create new one
					const configRequest = new Request('http://localhost/__lb_admin__/config', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(config)
					});
					await doStub.fetch(configRequest);
					console.log(`[Init] Initialized DO for ${trimmedHostname} with ${backends.length} backends from DEFAULT_BACKENDS`);
				}
			} catch (error) {
				console.error(`[Init] Failed to initialize DO for ${trimmedHostname} from DEFAULT_BACKENDS:`, error);
			}
		}
	}
} 
