import { LoadBalancerDO } from "./durable-object";

export { LoadBalancerDO };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const hostname = url.hostname;
		const isWorkerDomain = hostname.endsWith('.workers.dev');

		// Admin API on worker domain
		if (isWorkerDomain && url.pathname.startsWith('/admin/')) {
			return handleAdminAPI(request, url, env);
		}

		// Health check endpoint
		if (url.pathname === '/health') {
			return new Response(JSON.stringify({ status: 'healthy', timestamp: Date.now() }), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// All other requests -> Load Balancer (DO)
		const serviceHost = hostname;
		const doId = env.LOAD_BALANCER_DO.idFromName(serviceHost);
		const stub = env.LOAD_BALANCER_DO.get(doId);
		return stub.fetch(request);
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		if (env.DEFAULT_BACKENDS) {
			const entries = env.DEFAULT_BACKENDS.split(',');
			for (const entry of entries) {
				const [hostname] = entry.split('|');
				if (hostname) {
					const trimmedHostname = hostname.trim();
					try {
						const doId = env.LOAD_BALANCER_DO.idFromName(trimmedHostname);
						const stub = env.LOAD_BALANCER_DO.get(doId);
						const healthCheckRequest = new Request('http://localhost/__lb_admin__/health-check', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' }
						});
						ctx.waitUntil(stub.fetch(healthCheckRequest));
					} catch (error) {
						console.error(`[Scheduled] Failed to trigger health check for ${trimmedHostname}:`, error);
					}
				}
			}
		}
	},
} satisfies ExportedHandler<Env>;

async function handleAdminAPI(request: Request, url: URL, env: Env): Promise<Response> {
	const pathAfter = url.pathname.slice('/admin/'.length);
	const [serviceHost, ...ops] = pathAfter.split('/').filter(Boolean);
	
	// List all services
	if (serviceHost === 'list' && request.method === 'GET') {
		return handleListServices(env);
	}
	
	if (!serviceHost || ops.length === 0) {
		return new Response(JSON.stringify({ error: 'Invalid API path' }), { 
			status: 400, 
			headers: { 'Content-Type': 'application/json' } 
		});
	}

	// Route to DO
	const operation = ops.join('/');
	const doUrl = new URL(request.url);
	doUrl.pathname = `/__lb_admin__/${operation}`;
	const doRequest = new Request(doUrl.toString(), request);

	const doId = env.LOAD_BALANCER_DO.idFromName(serviceHost);
	const stub = env.LOAD_BALANCER_DO.get(doId);
	return stub.fetch(doRequest);
}

async function handleListServices(env: Env): Promise<Response> {
	try {
		const services: Record<string, any> = {};
		
		if (env.DEFAULT_BACKENDS) {
			const defaultBackends = env.DEFAULT_BACKENDS.split(',');
			for (const backendEntry of defaultBackends) {
				const [hostname, ...urls] = backendEntry.split('|');
				if (hostname && urls.length > 0) {
					const cleanHostname = hostname.trim();
					const cleanUrls = urls.map(url => url.trim());
					
					services[cleanHostname] = {
						mode: 'simple',
						backends: cleanUrls,
						source: 'default',
						hostname: cleanHostname,
						backendCount: cleanUrls.length,
						status: 'active'
					};
					
					// Try to get actual metrics from the DO
					try {
						const doId = env.LOAD_BALANCER_DO.idFromName(cleanHostname);
						const stub = env.LOAD_BALANCER_DO.get(doId);
						const metricsRequest = new Request('https://dummy/__lb_admin__/metrics', {
							method: 'GET'
						});
						const metricsResponse = await stub.fetch(metricsRequest);
						
						if (metricsResponse.ok) {
							const metrics = await metricsResponse.json();
							services[cleanHostname].metrics = metrics;
							services[cleanHostname].hasLiveData = true;
						}
					} catch (error) {
						services[cleanHostname].hasLiveData = false;
					}
				}
			}
		}
		
		return new Response(JSON.stringify({ 
			services,
			count: Object.keys(services).length,
			timestamp: new Date().toISOString()
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ 
			error: 'Failed to list services',
			details: error instanceof Error ? error.message : 'Unknown error'
		}), { 
			status: 500, 
			headers: { 'Content-Type': 'application/json' } 
		});
	}
}
