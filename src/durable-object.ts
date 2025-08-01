import { LoadBalancerServiceConfig, StoredState, Backend, ServiceMetrics } from "./types";
import { parseConfiguration, findMatchingService, expandWildcardBackends } from "./config-parser";
import { Logger } from "./logger";

export class LoadBalancerDO implements DurableObject {
	state: DurableObjectState;
	env: Env;
	config!: LoadBalancerServiceConfig;
	metrics!: ServiceMetrics;
	initialized: boolean = false;
	serviceHostname: string;
	private requestCountSinceSave: number = 0;
	private saveThreshold: number = 100;
	private logger: Logger;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		// Don't rely on state.id.name - extract hostname from first request instead
		this.serviceHostname = state.id.name || "__UNINITIALIZED__";
		this.logger = new Logger(env, this.serviceHostname);

		// Only initialize if we have a proper hostname
		if (this.serviceHostname !== "__UNINITIALIZED__") {
			this.state.blockConcurrencyWhile(async () => {
				try {
					await this.loadState();
				} catch (error) {
					await this.initializeConfiguration(this.serviceHostname);
				}
			});
		}
	}

	private async initializeConfiguration(serviceId: string) {
		this.logger.debug('Initializing configuration from DEFAULT_BACKENDS', { serviceId });
		
		if (!this.env.DEFAULT_BACKENDS) {
			const errorMsg = `DEFAULT_BACKENDS environment variable is not configured for service: ${serviceId}`;
			this.logger.error(errorMsg, { serviceId });
			throw new Error(errorMsg);
		}

		let backends: string[] = [];
		let isWildcardService = false;
		
		try {
			// Parse the configuration - handle both JSON and legacy formats
			const config = parseConfiguration(this.env.DEFAULT_BACKENDS);
			const matchingService = findMatchingService(serviceId, config);
			
			if (!matchingService) {
				const errorMsg = `No matching service configuration found for hostname: ${serviceId}. Available services: ${config.services.map(s => s.hostname).join(', ')}`;
				this.logger.error(errorMsg, { serviceId, availableServices: config.services.map(s => s.hostname) });
				throw new Error(errorMsg);
			}
			
			this.logger.debug('Found matching service configuration', { 
				serviceId, 
				hostname: matchingService.hostname,
				backendCount: matchingService.backends.length 
			});
			
			// Expand regex patterns in backends if this is a regex service
			if (matchingService.hostname.includes('(') || matchingService.hostname.includes('*')) {
				isWildcardService = true;
				
				this.logger.debug('Starting regex backend expansion', { 
					serviceId, 
					pattern: matchingService.hostname,
					originalBackends: matchingService.backends,
					hostname: serviceId
				});
				
				backends = expandWildcardBackends(serviceId, matchingService.backends, matchingService.hostname);
				
				this.logger.debug('Completed regex backend expansion', { 
					serviceId, 
					pattern: matchingService.hostname,
					originalCount: matchingService.backends.length,
					expandedCount: backends.length,
					expandedBackends: backends
				});
			} else {
				backends = matchingService.backends;
			}
			
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorMsg = `Failed to parse DEFAULT_BACKENDS configuration for service ${serviceId}: ${errorMessage}`;
			this.logger.error(errorMsg, { serviceId, error: errorMessage, configValue: this.env.DEFAULT_BACKENDS });
			throw new Error(errorMsg);
		}

		if (backends.length === 0) {
			const errorMsg = `No backends found after parsing configuration for service: ${serviceId}`;
			this.logger.error(errorMsg, { serviceId });
			throw new Error(errorMsg);
		}

		this.logger.info('Creating configuration with backends', { 
			serviceId, 
			backendCount: backends.length,
			isWildcardService 
		});
		
		// Create minimal configuration - everything else is implicit
		this.config = {
			serviceId,
			simpleBackends: backends,
			pools: [{
				id: "pool-1",
				name: "Primary Pool",
				backends: backends.map((url, index) => ({
					id: `backend-${index}`,
					url: url,
					ip: new URL(url).hostname,
					weight: 1,
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
				id: "lb-1",
				name: "Load Balancer",
				hostname: serviceId,
				default_pool_ids: ["pool-1"],
				proxied: true,
				enabled: true,
				steering_policy: "off",
				session_affinity: { 
					type: "none", 
					enabled: false
				}
			},
			currentRoundRobinIndex: 0,
			hostHeaderRewrite: 'preserve',
			observability: { 
				responseHeaderName: "X-Backend-Used",
				add_backend_header: true
			},
			ssl: {
				skipCertificateVerification: this.env.SSL_SKIP_CERTIFICATE_VERIFICATION === 'true' || 
					this.env.SSL_SKIP_CERTIFICATE_VERIFICATION === '1' || true, // Default to true for now
				allowSelfSignedCertificates: this.env.SSL_ALLOW_SELF_SIGNED_CERTIFICATES === 'true' || 
					this.env.SSL_ALLOW_SELF_SIGNED_CERTIFICATES === '1' || true, // Default to true for now
				skipHostnameVerification: this.env.SSL_SKIP_HOSTNAME_VERIFICATION === 'true' || 
					this.env.SSL_SKIP_HOSTNAME_VERIFICATION === '1' || true // Default to true for now
			}
		};
		await this.saveConfig();
	}

	private async loadState() {
		try {
			const stored = await this.state.storage.get<StoredState>("state");
			
			// Check if FORCE_ENV is set to force using DEFAULT_BACKENDS over stored config
			const forceEnv = this.env.FORCE_ENV && ['true', '1', 'yes'].includes(this.env.FORCE_ENV.toLowerCase());
			
			if (stored && stored.config && !forceEnv) {
				// Use existing stored configuration
				this.config = stored.config;
				this.config.serviceId = this.serviceHostname;
				
				if (!this.config.pools) {
					this.config.pools = [];
				}
				
				this.config.pools.forEach(pool => {
					if (pool.backends) {
						pool.backends.forEach(b => {
							b.requests = b.requests ?? 0;
							b.successfulRequests = b.successfulRequests ?? 0;
							b.failedRequests = b.failedRequests ?? 0;
							b.totalResponseTimeMs = b.totalResponseTimeMs ?? 0;
						});
					}
				});
			} else {
				// FORCE_ENV is set OR no stored config - initialize from DEFAULT_BACKENDS
				await this.initializeConfiguration(this.serviceHostname);
			}

			this.metrics = await this.state.storage.get<ServiceMetrics>("metrics") || {
				serviceId: this.config.serviceId,
				totalRequests: 0,
				totalSuccessfulRequests: 0,
				totalFailedRequests: 0,
				backendMetrics: {},
				poolMetrics: {}
			};
			
			this.metrics.serviceId = this.serviceHostname;

			let runningTotalRequests = 0, runningTotalSuccess = 0, runningTotalFailed = 0;
			if (this.config.pools) {
				this.config.pools.forEach(pool => {
					if (pool.backends) {
						pool.backends.forEach((b: Backend) => {
							if (!this.metrics.backendMetrics[b.id]) {
								this.metrics.backendMetrics[b.id] = {
									requests: b.requests || 0, 
									successfulRequests: b.successfulRequests || 0,
									failedRequests: b.failedRequests || 0, 
									totalResponseTimeMs: b.totalResponseTimeMs || 0,
									avgResponseTimeMs: 0
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
		} catch (error) {
			// If loading fails, try to initialize from DEFAULT_BACKENDS
			try {
				await this.initializeConfiguration(this.serviceHostname);
				this.metrics = {
					serviceId: this.serviceHostname,
					totalRequests: 0,
					totalSuccessfulRequests: 0,
					totalFailedRequests: 0,
					backendMetrics: {},
					poolMetrics: {}
				};
				this.initialized = true;
			} catch (initError) {
				// If initialization also fails, re-throw the original error
				throw error;
			}
		}
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
			const backendExistsInConfig = this.findBackendInPools(backendId);
			if (backendExistsInConfig) {
				this.metrics.backendMetrics[backendId] = { requests: 0, successfulRequests: 0, failedRequests: 0, totalResponseTimeMs: 0, avgResponseTimeMs: 0 };
			} else {
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
		const selectionId = crypto.randomUUID();
		const selectionLog = {
			selectionId,
			timestamp: new Date().toISOString(),
			decisions: [] as string[],
			actions: [] as string[],
			availableBackends: [] as any[],
			selectedBackend: null as any,
			selectionMethod: 'sequential'
		};
		
		try {
			// Decision: Check if configuration exists
			if (!this.config || !this.config.pools.length) {
				selectionLog.decisions.push("No configuration or pools available");
				return null;
			}
			
			selectionLog.decisions.push(`Configuration loaded with ${this.config.pools.length} pools`);
			
			// Get all backends from all pools
			const allBackends: Backend[] = [];
			this.config.pools.forEach((pool, poolIndex) => {
				selectionLog.decisions.push(`Processing pool ${pool.id} (${pool.name})`);
				
				pool.backends.forEach((b: Backend) => {
					allBackends.push(b);
					selectionLog.availableBackends.push({
						id: b.id,
						url: b.url,
						enabled: b.enabled,
						weight: b.weight,
						poolId: pool.id
					});
				});
			});
			
			selectionLog.decisions.push(`Found ${allBackends.length} total backends`);
			
			// DNS-first logic is handled in the main request handler, not here
			// This method only handles backend selection from the configured pools
			
			if (allBackends.length === 0) {
				selectionLog.decisions.push("No backends available");
				return null;
			}
			
			// SIMPLE SEQUENTIAL SELECTION: Pick the next backend in order
			// Use the current round-robin index to track position, but don't increment it
			const selectedIndex = this.config.currentRoundRobinIndex % allBackends.length;
			const selected = allBackends[selectedIndex];
			
			// Increment for next selection
			this.config.currentRoundRobinIndex = (this.config.currentRoundRobinIndex + 1) % allBackends.length;
			
			selectionLog.decisions.push(`Using sequential selection: index ${selectedIndex} of ${allBackends.length} backends`);
			selectionLog.actions.push(`Updated sequential index to ${this.config.currentRoundRobinIndex}`);
			
			// Action: Save the sequential index
			selectionLog.actions.push("Saving sequential index");
			this.state.waitUntil(this.state.storage.put("state.currentRoundRobinIndex", this.config.currentRoundRobinIndex));
			
			// Log selected backend details
			selectionLog.selectedBackend = {
				id: selected.id,
				url: selected.url,
				enabled: selected.enabled,
				weight: selected.weight,
				requests: selected.requests,
				successfulRequests: selected.successfulRequests,
				failedRequests: selected.failedRequests,
				poolId: this.config.pools.find(p => p.backends.some(b => b.id === selected.id))?.id
			};
			
			selectionLog.actions.push(`Selected backend: ${selected.id} (${selected.url})`);
			
			return selected;
			
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			selectionLog.decisions.push(`Error during backend selection: ${errorMessage}`);
			return null;
		} finally {
			// Log the complete selection audit trail
			this.logger.info('Backend selection audit trail', {
				selectionId: selectionLog.selectionId,
				timestamp: selectionLog.timestamp,
				decisions: selectionLog.decisions,
				actions: selectionLog.actions,
				availableBackends: selectionLog.availableBackends,
				selectedBackend: selectionLog.selectedBackend,
				selectionMethod: selectionLog.selectionMethod,
				totalBackends: selectionLog.availableBackends.length,
				enabledBackends: selectionLog.availableBackends.filter(b => b.enabled).length
			});
		}
	}

	private async forwardRequest(request: Request, backend: Backend, attempt: number = 0): Promise<Response> {
		const requestStartTime = Date.now();
		const forwardId = crypto.randomUUID();
		
		// Initialize forwarding audit log
		const forwardLog = {
			forwardId,
			attempt,
			backendId: backend.id,
			backendUrl: backend.url,
			requestMethod: request.method,
			requestUrl: request.url,
			startTime: new Date().toISOString(),
			decisions: [] as string[],
			actions: [] as string[],
			errors: [] as string[],
			response: null as any,
			duration: 0
		};
		
		try {
			const url = new URL(request.url);
			const backendUrl = new URL(backend.url);
			
			// TEMPORARILY DISABLED: Check if this request has already been routed by our worker
			// const alreadyRouted = request.headers.get('X-Worker-Routed');
			// if (alreadyRouted) {
			// 	forwardLog.decisions.push(`Request already routed by worker (${alreadyRouted}) - using direct fetch to prevent double-routing`);
			// 	
			// 	// Create a direct request to the backend without going through our routing
			// 	const directUrl = new URL(url.pathname + url.search, backend.url);
			// 	const headers = new Headers(request.headers);
			// 	
			// 	// Set the host header to the backend hostname
			// 	headers.set('Host', backendUrl.hostname);
			// 	headers.set('X-Forwarded-For', this.getClientIp(request) || '');
			// 	headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
			// 	headers.set('X-Forwarded-Host', url.hostname);
			// 	
			// 	const directRequest = new Request(directUrl.toString(), {
			// 		method: request.method,
			// 		headers,
			// 		body: request.body,
			// 		redirect: 'manual'
			// 	});
			// 	
			// 	// Prepare fetch options with SSL configuration
			// 	const fetchOptions: RequestInit & { cf?: any } = { 
			// 		signal: new AbortController().signal 
			// 	};

			// 	if (this.config.ssl) {
			// 		fetchOptions.cf = {};
			// 		if (this.config.ssl.skipCertificateVerification || this.config.ssl.allowSelfSignedCertificates) {
			// 			fetchOptions.cf.tls = { verify: false };
			// 		}
			// 	}
			// 	
			// 	forwardLog.actions.push("Making direct fetch to prevent double-routing");
			// 	const response = await fetch(directRequest, fetchOptions);
			// 	
			// 	const responseTime = Date.now() - requestStartTime;
			// 	forwardLog.duration = responseTime;
			// 	
			// 	// Record metrics
			// 	this.recordMetric(backend.id, response.ok && response.status < 400, responseTime);
			// 	
			// 	// Add backend header if configured
			// 	const newHeaders = new Headers(response.headers);
			// 	if (this.config.observability.add_backend_header) {
			// 		newHeaders.set('X-Backend-Used', backend.id);
			// 	}
			// 	
			// 	const finalResponse = new Response(response.body, {
			// 		status: response.status,
			// 		statusText: response.statusText,
			// 		headers: newHeaders
			// 	});
			// 	
			// 	forwardLog.response = {
			// 		status: response.status,
			// 		statusText: response.statusText,
			// 		ok: response.ok,
			// 		headers: Object.fromEntries(response.headers.entries())
			// 	};
			// 	
			// 	return finalResponse;
			// }
			
			const forwardUrl = new URL(url.pathname + url.search, backend.url);
			
			forwardLog.decisions.push(`Forwarding to: ${forwardUrl.toString()}`);
			forwardLog.actions.push(`Attempt ${attempt + 1} for backend ${backend.id}`);
			
			const headers = new Headers(request.headers);
			
			// Decision: Handle host header rewrite
			if (this.config.hostHeaderRewrite === 'backend_hostname') {
				headers.set('Host', backendUrl.host);
				forwardLog.decisions.push(`Host header rewritten to backend hostname: ${backendUrl.host}`);
			} else if (this.config.hostHeaderRewrite !== 'preserve' && typeof this.config.hostHeaderRewrite === 'string') {
				headers.set('Host', this.config.hostHeaderRewrite);
				forwardLog.decisions.push(`Host header rewritten to custom value: ${this.config.hostHeaderRewrite}`);
			} else {
				forwardLog.decisions.push("Host header preserved");
			}
			
			// Action: Set forwarding headers
			headers.set('X-Forwarded-For', this.getClientIp(request) || '');
			headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
			headers.set('X-Forwarded-Host', url.host);
			
			// TEMPORARILY DISABLED: Add header to mark this request as routed by our worker
			// headers.set('X-Worker-Routed', this.serviceHostname);
			// forwardLog.actions.push("Added X-Worker-Routed header to prevent double-routing");
			
			const newRequest = new Request(forwardUrl.toString(), {
				method: request.method,
				headers,
				body: request.body,
				redirect: 'manual'
			});
			
			// Decision: Check if request is non-idempotent
			const isNonIdempotent = ['POST', 'PUT', 'PATCH'].includes(request.method);
			if (isNonIdempotent) {
				forwardLog.decisions.push("Non-idempotent request detected");
			}
			
			// Prepare fetch options with SSL configuration
			const fetchOptions: RequestInit & { cf?: any } = { 
				signal: new AbortController().signal 
			};

			// Decision: Configure SSL settings
			if (this.config.ssl) {
				forwardLog.decisions.push("SSL configuration applied");
				fetchOptions.cf = {};
				
				if (this.config.ssl.skipCertificateVerification || this.config.ssl.allowSelfSignedCertificates) {
					fetchOptions.cf.tls = {
						verify: false
					};
					forwardLog.decisions.push("SSL certificate verification disabled");
				}
			}

			// Action: Make the request
			forwardLog.actions.push("Initiating fetch request");
			const controller = new AbortController();
			const timeout = setTimeout(() => {
				controller.abort();
				forwardLog.errors.push("Request timeout after 30 seconds");
			}, 30000);
			
			fetchOptions.signal = controller.signal;
			const response = await fetch(newRequest, fetchOptions);
			clearTimeout(timeout);
			
			const responseTime = Date.now() - requestStartTime;
			forwardLog.duration = responseTime;
			forwardLog.actions.push(`Response received in ${responseTime}ms`);
			
			// Log response details
			forwardLog.response = {
				status: response.status,
				statusText: response.statusText,
				ok: response.ok,
				headers: Object.fromEntries(response.headers.entries())
			};
			
			// Action: Record metrics (only 2xx/3xx are considered successful)
			this.recordMetric(backend.id, response.status >= 200 && response.status < 400, responseTime);
			forwardLog.actions.push("Metrics recorded");
			
			// Decision: Handle successful response (only 2xx and 3xx are truly successful)
			if (response.status >= 200 && response.status < 400) {
				forwardLog.decisions.push("Response considered successful (2xx/3xx)");
				
				// Action: Add backend header if configured
				const newHeaders = new Headers(response.headers);
				if (this.config.observability.add_backend_header) {
					newHeaders.set('X-Backend-Used', backend.id);
					forwardLog.actions.push("Backend header added to response");
				}
				
				const finalResponse = new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: newHeaders
				});
				
				forwardLog.actions.push("Successful response returned");
				return finalResponse;
				
			} else {
				// Decision: Handle error response (4xx and 5xx should trigger failover)
				forwardLog.decisions.push(`Response status ${response.status} (4xx/5xx) - throwing error to trigger failover`);
				
				// Throw an error to trigger failover to the next backend
				throw new Error(`Backend ${backend.id} returned error status ${response.status}: ${response.statusText}`);
			}
			
		} catch (error) {
			const errorType = error instanceof DOMException && error.name === 'AbortError' ? 'Timeout' : 'Connection';
			const errorMessage = error instanceof Error ? error.message : String(error);
			
			forwardLog.errors.push(`${errorType} error: ${errorMessage}`);
			forwardLog.duration = Date.now() - requestStartTime;
			
			// Action: Record failure metric
			this.recordMetric(backend.id, false, forwardLog.duration);
			forwardLog.actions.push("Failure metric recorded");
			
			// No retry logic - just throw the error
			throw new Error(`${errorType} error connecting to backend ${backend.id}: ${errorMessage}`);
		} finally {
			// Log the complete forwarding audit trail
			this.logger.info('Forward request audit trail', {
				forwardId: forwardLog.forwardId,
				attempt: forwardLog.attempt,
				backendId: forwardLog.backendId,
				backendUrl: forwardLog.backendUrl,
				duration: forwardLog.duration,
				decisions: forwardLog.decisions,
				actions: forwardLog.actions,
				errors: forwardLog.errors,
				response: forwardLog.response,
				requestMethod: forwardLog.requestMethod,
				requestUrl: forwardLog.requestUrl,
				startTime: forwardLog.startTime
			});
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
			case 'metrics':
				return this.generateMetricsResponse();
			case 'config':
				return this.handleConfigRequest(request);
			default:
				return new Response('Unknown operation', { status: 404 });
		}
	}

	private async handleBackendsRequest(request: Request): Promise<Response> {
		const method = request.method;

		switch (method) {
			case 'GET':
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
					enabledBackends: allBackends.filter(b => b.enabled).length,
					disabledBackends: allBackends.filter(b => !b.enabled).length
				}), {
					headers: { 'Content-Type': 'application/json' }
				});

			default:
				return new Response('Method not allowed', { status: 405 });
		}
	}

	private async handleConfigRequest(request: Request): Promise<Response> {
		const method = request.method;

		switch (method) {
			case 'GET':
				return new Response(JSON.stringify({
					serviceId: this.config.serviceId,
					backends: this.config.simpleBackends || this.config.pools.flatMap(p => p.backends.map(b => b.url)),
					pools: this.config.pools,
					load_balancer: this.config.load_balancer,
					metrics: this.metrics,
					source: this.config.simpleBackends ? 'default' : 'custom'
				}), {
					headers: { 'Content-Type': 'application/json' }
				});

			default:
				return new Response('Method not allowed', { status: 405 });
		}
	}

	private generateMetricsResponse(): Response {
		this.calculateAvgResponseTimes();
		return new Response(JSON.stringify({
			serviceId: this.serviceHostname,
			totalRequests: this.metrics.totalRequests,
			totalSuccessfulRequests: this.metrics.totalSuccessfulRequests,
			totalFailedRequests: this.metrics.totalFailedRequests,
			backendMetrics: this.metrics.backendMetrics,
			config: this.config
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	async handleRequest(request: Request): Promise<Response> {
		const requestStartTime = Date.now();
		const url = new URL(request.url);
		const requestId = crypto.randomUUID();
		
		// Initialize audit log object to capture everything
		const auditLog = {
			requestId,
			timestamp: new Date().toISOString(),
			request: {
				method: request.method,
				url: request.url,
				hostname: url.hostname,
				pathname: url.pathname,
				search: url.search,
				headers: Object.fromEntries(request.headers.entries()),
				clientIp: this.getClientIp(request)
			},
			decisions: [] as string[],
			actions: [] as string[],
			errors: [] as string[],
			backend: null as any,
			response: null as any,
			duration: 0
		};
		
		try {
			// Decision: Initialize hostname from request if not already set
			if (this.serviceHostname === "__UNINITIALIZED__") {
				this.serviceHostname = url.hostname;
				this.logger = new Logger(this.env, this.serviceHostname);
				auditLog.decisions.push(`Extracted hostname from request: ${this.serviceHostname}`);
			}
			
			// Decision: Load state if not initialized
			if (!this.initialized) {
				auditLog.decisions.push("Loading state - not initialized");
				await this.loadState();
				auditLog.actions.push("State loaded successfully");
			}
			
			// Decision: Handle admin requests
			if (url.pathname.startsWith('/__lb_admin__/')) {
				auditLog.decisions.push("Routing to admin handler");
				const response = await this.handleAdminRequest(request);
				auditLog.response = {
					status: response.status,
					statusText: response.statusText,
					headers: Object.fromEntries(response.headers.entries())
				};
				auditLog.actions.push("Admin request handled");
				return response;
			}
			
			// Decision: Check for DNS-first mode
			const isDnsFirstEnabled = request.headers.get('X-DNS-First-Enabled') === 'true';
			const dnsFirstReason = request.headers.get('X-Fallback-Reason');
			
			if (isDnsFirstEnabled) {
				auditLog.decisions.push(`DNS-first mode enabled: ${dnsFirstReason}`);
				
				// Try direct DNS resolution first
				try {
					const dnsStartTime = Date.now();
					const dnsUrl = new URL(request.url);
					const dnsHostname = dnsUrl.hostname;
					
					auditLog.actions.push(`Attempting direct DNS resolution to ${dnsHostname}`);
					
					// Create a direct request to the original hostname
					const directRequest = new Request(request.url, {
						method: request.method,
						headers: request.headers,
						body: request.body,
						redirect: 'manual'
					});
					
					// Make the direct request
					const dnsResponse = await fetch(directRequest);
					const dnsResponseTime = Date.now() - dnsStartTime;
					
					auditLog.actions.push(`DNS resolution completed in ${dnsResponseTime}ms with status ${dnsResponse.status}`);
					
					// If DNS resolution succeeds (2xx status), return the response
					if (dnsResponse.ok) {
						auditLog.decisions.push("DNS resolution successful - returning direct response");
						
						const newHeaders = new Headers(dnsResponse.headers);
						newHeaders.set('X-DNS-First-Enabled', 'true');
						newHeaders.set('X-DNS-Resolution-Time', dnsResponseTime.toString());
						newHeaders.set('X-Fallback-Reason', 'DNS resolution successful');
						
						const finalResponse = new Response(dnsResponse.body, {
							status: dnsResponse.status,
							statusText: dnsResponse.statusText,
							headers: newHeaders
						});
						
						auditLog.response = {
							status: finalResponse.status,
							statusText: finalResponse.statusText,
							headers: Object.fromEntries(finalResponse.headers.entries())
						};
						auditLog.actions.push("Direct DNS response returned successfully");
						return finalResponse;
					} else {
						auditLog.decisions.push(`DNS resolution failed with status ${dnsResponse.status} - falling back to load balancer`);
						auditLog.actions.push("Proceeding to load balancer backends");
					}
				} catch (error) {
					auditLog.decisions.push(`DNS resolution failed with error: ${error}`);
					auditLog.actions.push("Proceeding to load balancer backends due to DNS error");
				}
			}
			
			// Decision: Select backend
			auditLog.decisions.push("Selecting backend from pool");
			const selectedBackend = this.selectBackend(request);
			
			if (!selectedBackend) {
				auditLog.decisions.push("No backends available to forward request for '" + url.hostname + "'");
				auditLog.errors.push("All backends disabled, or no backends available to forward request for '" + url.hostname + "'");
				const response = new Response("No backends available to forward request for '" + url.hostname + "'", { 
					status: 503,
					headers: {
						'X-DNS-First-Fallback': 'true',
						'X-Fallback-Reason': 'No backends available to forward request for ' + url.hostname
					}
				});
				auditLog.response = {
					status: response.status,
					statusText: response.statusText,
					headers: Object.fromEntries(response.headers.entries())
				};
				auditLog.actions.push("Returned 503 - no backends available to forward request for '" + url.hostname + "'");
				return response;
			}
			
			// Log selected backend details
			auditLog.backend = {
				id: selectedBackend.id,
				url: selectedBackend.url,
				weight: selectedBackend.weight,
				consecutiveFailures: selectedBackend.consecutiveFailures,
				requests: selectedBackend.requests,
				successfulRequests: selectedBackend.successfulRequests,
				failedRequests: selectedBackend.failedRequests
			};
			auditLog.decisions.push(`Selected backend: ${selectedBackend.id} (${selectedBackend.url})`);
			
			// Action: Forward request to backend with failover
			auditLog.actions.push("Forwarding request to backend with failover");
			
			// Get all available backends for failover
			const allBackends = this.config.pools.flatMap(pool => pool.backends);
			let currentBackendIndex = allBackends.findIndex(b => b.id === selectedBackend.id);
			let response: Response | null = null;
			let lastError: Error | null = null;
			
			// Try backends in sequence until one succeeds
			for (let attempt = 0; attempt < allBackends.length; attempt++) {
				const backendToTry = allBackends[(currentBackendIndex + attempt) % allBackends.length];
				
				auditLog.decisions.push(`Attempt ${attempt + 1}: trying backend ${backendToTry.id} (${backendToTry.url})`);
				
				try {
					const backendResponse = await this.forwardRequest(request, backendToTry, attempt);
					
					// Check if this is a successful response (2xx/3xx)
					if (backendResponse.status >= 200 && backendResponse.status < 400) {
						auditLog.decisions.push(`Backend ${backendToTry.id} returned successful response (${backendResponse.status})`);
						response = backendResponse;
						break;
					} else {
						auditLog.decisions.push(`Backend ${backendToTry.id} returned error response (${backendResponse.status}) - trying next backend`);
						lastError = new Error(`Backend ${backendToTry.id} returned status ${backendResponse.status}`);
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					auditLog.decisions.push(`Backend ${backendToTry.id} failed with error: ${errorMessage} - trying next backend`);
					lastError = error instanceof Error ? error : new Error(String(error));
				}
			}
			
			// If no backend succeeded, return the last error or a generic error
			if (!response) {
				auditLog.decisions.push("All backends failed - returning error response");
				const errorMessage = lastError ? lastError.message : "All backends failed";
				response = new Response(`All backends failed: ${errorMessage}`, { 
					status: 503,
					headers: {
						'X-DNS-First-Fallback': 'true',
						'X-Fallback-Reason': 'All backends failed'
					}
				});
			}
			
			// Decision: Add DNS-first headers if needed
			if (isDnsFirstEnabled) {
				auditLog.decisions.push("Adding DNS-first mode headers to response");
				const newHeaders = new Headers(response.headers);
				newHeaders.set('X-DNS-First-Enabled', 'true');
				newHeaders.set('X-Fallback-Reason', dnsFirstReason || 'Unknown');
				
				const modifiedResponse = new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: newHeaders
				});
				
				auditLog.response = {
					status: modifiedResponse.status,
					statusText: modifiedResponse.statusText,
					headers: Object.fromEntries(modifiedResponse.headers.entries())
				};
				auditLog.actions.push("DNS-first mode headers added to response");
				return modifiedResponse;
			}
			
			// Log final response details
			auditLog.response = {
				status: response.status,
				statusText: response.statusText,
				headers: Object.fromEntries(response.headers.entries())
			};
			auditLog.actions.push("Request successfully forwarded and response returned");
			
			return response;
			
		} catch (error) {
			// Log error details
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			auditLog.errors.push(`Request processing failed: ${errorMessage}`);
			
			if (errorStack) {
				auditLog.errors.push(`Stack trace: ${errorStack}`);
			}
			
			const errorResponse = new Response(`Error routing request: ${errorMessage}`, { 
				status: 500,
				headers: {
					'X-DNS-First-Fallback': 'true',
					'X-Fallback-Reason': 'Load balancer error'
				}
			});
			
			auditLog.response = {
				status: errorResponse.status,
				statusText: errorResponse.statusText,
				headers: Object.fromEntries(errorResponse.headers.entries())
			};
			auditLog.actions.push("Returned 500 error response");
			
			return errorResponse;
		} finally {
			// Calculate duration and log complete audit trail
			auditLog.duration = Date.now() - requestStartTime;
			
			// Log the complete audit trail
			this.logger.info('Request audit trail', {
				requestId: auditLog.requestId,
				duration: auditLog.duration,
				request: auditLog.request,
				decisions: auditLog.decisions,
				actions: auditLog.actions,
				errors: auditLog.errors,
				backend: auditLog.backend,
				response: auditLog.response,
				serviceHostname: this.serviceHostname,
				initialized: this.initialized,
				configLoaded: !!this.config,
				poolCount: this.config?.pools?.length || 0,
				totalBackends: this.config?.pools?.reduce((count, pool) => count + pool.backends.length, 0) || 0,
				enabledBackends: this.config?.pools?.reduce((count, pool) => 
					count + pool.backends.filter(b => b.enabled).length, 0) || 0
			});
		}
	}

	async fetch(request: Request): Promise<Response> {
		try {
			return await this.handleRequest(request);
		} catch (error) {
			return new Response(`Server error: ${error}`, { status: 500 });
		}
	}
}
