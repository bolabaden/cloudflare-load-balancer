import { LoadBalancerDO } from "./durable-object";
import { parseConfiguration, findMatchingService, expandWildcardBackends } from "./config-parser";

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

		// Always use load balancer, but pass DNS-first flag
		const dnsFirstEnabled = env.DNS_FIRST === 'true' || env.DNS_FIRST === '1';
		return handleLoadBalancerFallback(request, env, ctx, hostname, dnsFirstEnabled ? 'DNS-first enabled' : 'Standard mode');
	}
};

async function handleLoadBalancerFallback(
	request: Request, 
	env: Env, 
	ctx: ExecutionContext, 
	hostname: string, 
	fallbackReason: string
): Promise<Response> {
	// Get or create the Durable Object instance
	const id = env.LOAD_BALANCER_DO.idFromName(hostname);
	const durableObject = env.LOAD_BALANCER_DO.get(id);
	
	// Add DNS-first flag to the request
	const dnsFirstEnabled = env.DNS_FIRST === 'true' || env.DNS_FIRST === '1';
	const modifiedRequest = new Request(request.url, {
		method: request.method,
		headers: {
			...Object.fromEntries(request.headers.entries()),
			'X-DNS-First-Enabled': dnsFirstEnabled ? 'true' : 'false',
			'X-Fallback-Reason': fallbackReason
		},
		body: request.body
	});
	
	return durableObject.fetch(modifiedRequest);
}

async function handleAdminAPI(request: Request, url: URL, env: Env): Promise<Response> {
	const path = url.pathname;
	
	if (path === '/admin/config') {
		// Return the current configuration
		const id = env.LOAD_BALANCER_DO.idFromName('admin');
		const durableObject = env.LOAD_BALANCER_DO.get(id);
		return durableObject.fetch(request);
	}
	
	return new Response('Not found', { status: 404 });
}
