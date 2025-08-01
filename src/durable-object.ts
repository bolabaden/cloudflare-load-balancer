import { LoadBalancerServiceConfig, StoredState, Backend, ServiceMetrics } from "./types";

export class LoadBalancerDO implements DurableObject {
	state: DurableObjectState;
	env: Env;
	config!: LoadBalancerServiceConfig;
	metrics!: ServiceMetrics;
	initialized: boolean = false;
	serviceHostname: string;
	private requestCountSinceSave: number = 0;
	private saveThreshold: number = 100;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.serviceHostname = state.id.name || "default-service";

		this.state.blockConcurrencyWhile(async () => {
			try {
				await this.loadState();
			} catch (error) {
				await this.initializeEmptyConfig(this.serviceHostname);
			}
		});
	}

	private async initializeEmptyConfig(serviceId: string) {
		const defaultBackends = this.env.DEFAULT_BACKENDS?.split(',')
			.find(entry => entry.split('|')[0].trim() === serviceId);
		
		if (defaultBackends) {
			const [hostname, ...urls] = defaultBackends.split('|');
			this.config = {
				serviceId,
				mode: 'simple',
				simpleBackends: urls.map(url => url.trim()),
				pools: [{
					id: "simple-pool",
					name: "Simple Failover Pool",
					backends: urls.map((url, index) => ({
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
				}],
				load_balancer: {
					id: "simple-lb",
					name: "Simple Load Balancer",
					hostname: serviceId,
					default_pool_ids: ["simple-pool"],
					proxied: true,
					enabled: true,
					steering_policy: "off",
					session_affinity: { type: "none", enabled: false }
				},
				currentRoundRobinIndex: 0,
				passiveHealthChecks: { 
					max_failures: 3, 
					failure_timeout_ms: 30000, 
					retryable_status_codes: [500, 502, 503, 504], 
					enabled: true, 
					monitor_timeout: 10 
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
			this.config = {
				serviceId,
				mode: 'advanced',
				pools: [{
					id: "default-pool",
					name: "Default Pool",
					backends: [{
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
					}],
					enabled: true,
					minimum_origins: 1,
					endpoint_steering: 'round_robin'
				}],
				load_balancer: {
					id: "default-lb",
					name: "Default Load Balancer",
					hostname: serviceId,
					default_pool_ids: ["default-pool"],
					proxied: true,
					enabled: true,
					steering_policy: "off",
					session_affinity: { type: "none", enabled: false }
				},
				currentRoundRobinIndex: 0,
				passiveHealthChecks: { max_failures: 3, failure_timeout_ms: 30000, retryable_status_codes: [500, 502, 503, 504], enabled: true, monitor_timeout: 10 },
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
		} catch (error) {
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
		if (!this.config || !this.config.pools.length) {
			return null;
		}

		let configChangedDueToHealthRevival = false;
		const healthyBackends: Backend[] = [];
		this.config.pools.forEach(pool => {
			pool.backends.forEach((b: Backend) => {
				if (b.healthy) {
					healthyBackends.push(b);
				} else if (Date.now() - (b.lastFailureTimestamp || 0) > this.config.passiveHealthChecks.failure_timeout_ms) {
					b.healthy = true; 
					b.consecutiveFailures = 0; 
					configChangedDueToHealthRevival = true;
					healthyBackends.push(b);
				}
			});
		});

		if (healthyBackends.length === 0) {
			if (configChangedDueToHealthRevival) this.state.waitUntil(this.saveConfig());
			return null;
		}
		
		const hasWeights = healthyBackends.some(b => b.weight !== 1);
		let selected: Backend;

		if (hasWeights) {
			const totalWeight = healthyBackends.reduce((sum, b) => sum + b.weight, 0);
			const weightedIndex = this.config.currentRoundRobinIndex % totalWeight;
			
			let currentWeight = 0;
			selected = healthyBackends[0];
			for (const backend of healthyBackends) {
				currentWeight += backend.weight;
				if (weightedIndex < currentWeight) {
					selected = backend;
					break;
				}
			}
			this.config.currentRoundRobinIndex = (this.config.currentRoundRobinIndex + 1) % totalWeight;
		} else {
			this.config.currentRoundRobinIndex = (this.config.currentRoundRobinIndex + 1) % healthyBackends.length;
			selected = healthyBackends[this.config.currentRoundRobinIndex];
		}

		if (configChangedDueToHealthRevival) this.state.waitUntil(this.saveConfig());
		else this.state.waitUntil(this.state.storage.put("state.currentRoundRobinIndex", this.config.currentRoundRobinIndex));

		return selected;
	}

	private async forwardRequest(request: Request, backend: Backend, attempt: number = 0): Promise<Response> {
		const requestStartTime = Date.now();
		
		const url = new URL(request.url);
		const backendUrl = new URL(backend.url);
		const forwardUrl = new URL(url.pathname + url.search, backend.url);
		
		const headers = new Headers(request.headers);
		
		if (this.config.hostHeaderRewrite === 'backend_hostname') {
			headers.set('Host', backendUrl.host);
		} else if (this.config.hostHeaderRewrite !== 'preserve' && typeof this.config.hostHeaderRewrite === 'string') {
			headers.set('Host', this.config.hostHeaderRewrite);
		}
		
		headers.set('X-Forwarded-For', this.getClientIp(request) || '');
		headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
		headers.set('X-Forwarded-Host', url.host);
		
		const newRequest = new Request(forwardUrl.toString(), {
			method: request.method,
			headers,
			body: request.body,
			redirect: 'manual'
		});
		
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 30000);
			
			const isNonIdempotent = ['POST', 'PUT', 'PATCH'].includes(request.method);
			
			const response = await fetch(newRequest, { signal: controller.signal });
			clearTimeout(timeout);
			
			this.recordMetric(backend.id, response.ok && response.status < 400, Date.now() - requestStartTime);
			
			if (response.ok || (response.status < 500 && !this.config.passiveHealthChecks.retryable_status_codes.includes(response.status))) {
				if (backend.consecutiveFailures > 0 || !backend.healthy) {
					backend.consecutiveFailures = 0; backend.healthy = true; backend.status = "Healthy";
					this.state.waitUntil(this.saveConfig());
				}
				
				const newHeaders = new Headers(response.headers);
				
				if (this.config.observability.add_backend_header) {
					newHeaders.set('X-Backend-Used', backend.id);
				}
				
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: newHeaders
				});
			} else {
				if (this.config.passiveHealthChecks.retryable_status_codes.includes(response.status)) {
					backend.consecutiveFailures++; backend.lastFailureTimestamp = Date.now(); backend.status = `Failed (status ${response.status})`;
					if (backend.consecutiveFailures >= this.config.passiveHealthChecks.max_failures) {
						backend.healthy = false; backend.status = `Unhealthy (status ${response.status}, ${backend.consecutiveFailures} fails)`;
						this.state.waitUntil(this.saveConfig());
					}
					
					const shouldRetry = attempt < this.config.retryPolicy.max_retries &&
						(!isNonIdempotent || response.status >= 502);
					
					if (shouldRetry) {
						const nextBackend = this.selectBackend(request);
						if (nextBackend && nextBackend.id !== backend.id) {
							return this.forwardRequest(request, nextBackend, attempt + 1);
						} else if (nextBackend && nextBackend.id === backend.id) {
							const healthyBackendCount = this.config.pools.reduce((count, pool) => {
								return count + pool.backends.filter(b => b.healthy || 
									(Date.now() - (b.lastFailureTimestamp || 0) > this.config.passiveHealthChecks.failure_timeout_ms)).length;
							}, 0);
							
							if (healthyBackendCount === 1) {
								return this.forwardRequest(request, nextBackend, attempt + 1);
							}
						}
					}
				}
				
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers
				});
			}
		} catch (error) {
			const errorType = error instanceof DOMException && error.name === 'AbortError' ? 'Timeout' : 'Connection';
			
			this.recordMetric(backend.id, false, Date.now() - requestStartTime);
			
			backend.consecutiveFailures++; backend.lastFailureTimestamp = Date.now(); backend.status = `Error (${errorType})`;
			if (backend.consecutiveFailures >= this.config.passiveHealthChecks.max_failures) {
				backend.healthy = false; backend.status = `Unhealthy (${errorType}, ${backend.consecutiveFailures} fails)`;
				this.state.waitUntil(this.saveConfig());
			}
			
			const isNonIdempotent = ['POST', 'PUT', 'PATCH'].includes(request.method);
			const shouldRetry = attempt < this.config.retryPolicy.max_retries &&
				(!isNonIdempotent || errorType === 'Timeout');
			
			if (shouldRetry) {
				const nextBackend = this.selectBackend(request);
				if (nextBackend && nextBackend.id !== backend.id) {
					return this.forwardRequest(request, nextBackend, attempt + 1);
				} else if (nextBackend && nextBackend.id === backend.id) {
					const healthyBackendCount = this.config.pools.reduce((count, pool) => {
						return count + pool.backends.filter(b => b.healthy || 
							(Date.now() - (b.lastFailureTimestamp || 0) > this.config.passiveHealthChecks.failure_timeout_ms)).length;
					}, 0);
					
					if (healthyBackendCount === 1) {
						return this.forwardRequest(request, nextBackend, attempt + 1);
					}
				}
			}
			
			throw new Error(`${errorType} error connecting to backend ${backend.id}: ${error}`);
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
					healthyBackends: allBackends.filter(b => b.healthy).length,
					unhealthyBackends: allBackends.filter(b => !b.healthy).length
				}), {
					headers: { 'Content-Type': 'application/json' }
				});

			default:
				return new Response('Method not allowed', { status: 405 });
		}
	}

	private async handleHealthRequest(): Promise<Response> {
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

	private async handleConfigRequest(request: Request): Promise<Response> {
		const method = request.method;

		switch (method) {
			case 'GET':
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
		if (!this.initialized) {
			await this.loadState();
		}

		const url = new URL(request.url);
		
		if (url.pathname.startsWith('/__lb_admin__/')) {
			return this.handleAdminRequest(request);
		}
		
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
		
		try {
			const selectedBackend = this.selectBackend(request);
			
			if (!selectedBackend) {
				return new Response("No healthy backends available", { status: 503 });
			}
			
			return await this.forwardRequest(request, selectedBackend);
		} catch (error) {
			return new Response(`Error routing request: ${error}`, { status: 500 });
		}
	}

	async fetch(request: Request): Promise<Response> {
		try {
			return await this.handleRequest(request);
		} catch (error) {
			return new Response(`Server error: ${error}`, { status: 500 });
		}
	}

	private async handleActiveHealthCheck(backend: Backend): Promise<boolean> {
		try {
			const config = this.config.activeHealthChecks;
			if (!config || !config.enabled) return backend.healthy;

			const url = new URL(config.path, backend.url).toString();
			
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), config.timeout * 1000);
			
			const response = await fetch(url, {
				method: config.method || 'GET',
				headers: config.headers || {},
				redirect: config.follow_redirects ? 'follow' : 'manual',
				signal: controller.signal
			});
			
			clearTimeout(timeoutId);
			
			const isStatusValid = config.expected_codes 
				? config.expected_codes.includes(response.status)
				: response.status < 400;
			
			let isBodyValid = true;
			if (config.expected_body) {
				const body = await response.text();
				isBodyValid = body.includes(config.expected_body);
			}
			
			const isHealthy = isStatusValid && isBodyValid;
			
			if (isHealthy) {
				backend.consecutiveFailures = 0;
				if (!backend.healthy) {
					backend.healthy = true;
					await this.saveConfig();
				}
			} else {
				backend.consecutiveFailures++;
				if (backend.consecutiveFailures >= config.consecutive_down && backend.healthy) {
					backend.healthy = false;
					backend.lastFailureTimestamp = Date.now();
					await this.saveConfig();
				}
			}
			
			return backend.healthy;
		} catch (error) {
			backend.consecutiveFailures++;
			
			if (backend.consecutiveFailures >= (this.config.activeHealthChecks?.consecutive_down || 3) && backend.healthy) {
				backend.healthy = false;
				backend.lastFailureTimestamp = Date.now();
				await this.saveConfig();
			}
			
			return backend.healthy;
		}
	}
}
