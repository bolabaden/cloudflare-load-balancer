import { DurableObject } from "cloudflare:workers";
import { LoadBalancerDO } from "./durable-object";

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject<Env> {
	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	/**
	 * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
	 *  Object instance receives a request from a Worker via the same method invocation on the stub
	 *
	 * @param name - The name provided to a Durable Object instance from a Worker
	 * @returns The greeting to be sent back to the Worker
	 */
	async sayHello(name: string): Promise<string> {
		return `Hello, ${name}!`;
	}
}

export { LoadBalancerDO }; // Required for Wrangler to recognize the DO class

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const requestHostname = url.hostname; // The hostname the client actually requested

		// Define special path prefixes for load balancer administration and metrics
		// These are designed to be unique and unlikely to clash with actual application paths.
		const adminPathPrefix = "/__lb_admin__/";
		const metricsPathPrefix = "/__lb_metrics__/";

		let serviceHostnameForDO = requestHostname; // By default, the DO instance is for the hostname the client requested
		let actualRequestForDO = request; // This might be modified for API calls

		// Check if the request is an API call to the load balancer itself
		if (url.pathname.startsWith(adminPathPrefix) || url.pathname.startsWith(metricsPathPrefix)) {
			const pathSegments = url.pathname.split('/').filter(Boolean); // Remove empty segments

			// Expected API path structure:
			// /__lb_admin__/{target_service_hostname}/{operation}  (e.g., /__lb_admin__/app.example.com/config)
			// /__lb_metrics__/{target_service_hostname}/{format}   (e.g., /__lb_metrics__/app.example.com/html)
			if (pathSegments.length >= 3) {
				serviceHostnameForDO = pathSegments[1]; // The second segment is the target service hostname

				// Reconstruct the internal path for the Durable Object to handle.
				// e.g., if request is /__lb_admin__/app.example.com/config, DO sees /__lb_admin__/config
				const doInternalPath = "/" + pathSegments[0] + "/" + pathSegments.slice(2).join("/");
				
				const doUrl = new URL(request.url); // Clone original URL
				doUrl.pathname = doInternalPath;    // Set the simplified path for the DO
				actualRequestForDO = new Request(doUrl.toString(), request); // Create a new request with the modified URL

			} else {
				// If the path structure is not as expected, return an error
				return new Response(
					`Invalid API path structure. Expected: ${adminPathPrefix}{service-hostname}/{operation} or ${metricsPathPrefix}{service-hostname}/{format}`,
					{ status: 400 }
				);
			}

			// Authenticate API calls using a secret stored in the environment
			const authHeader = request.headers.get("Authorization");
			const expectedAuth = `Bearer ${env.API_SECRET}`;
			if (!env.API_SECRET || authHeader !== expectedAuth) { // Check if secret is missing or auth header doesn't match
				console.warn(
					`Unauthorized API access attempt: ${request.method} ${url.pathname} for service ${serviceHostnameForDO}. ` +
					`IP: ${request.headers.get("CF-Connecting-IP")}. Auth Header: ${authHeader ? authHeader.substring(0,15)+"..." : "None"}`
				);
				return new Response("Unauthorized", { status: 401 });
			}
			console.log(`Authorized API call for service ${serviceHostnameForDO}: ${actualRequestForDO.method} ${actualRequestForDO.url}`);
		} else {
			// For regular traffic, log the request for debugging
			console.log(`[Worker] Routing request: ${request.method} ${url.pathname} -> DO for ${serviceHostnameForDO}`);
		}

		// Ensure a service hostname for the DO has been determined
		if (!serviceHostnameForDO) {
			console.error(`[Worker Logic Error] Could not determine target service hostname for DO. Original request: ${request.url}`);
			return new Response("Internal error: Could not determine target service hostname for Durable Object.", { status: 500 });
		}

		try {
			// Get a Durable Object ID based on the service hostname. This ensures that all requests
			// for the same service (e.g., "aiostreams.bolabaden.org") are routed to the same DO instance.
			const durableObjectId = env.LOAD_BALANCER_DO.idFromName(serviceHostnameForDO);
			const stub = env.LOAD_BALANCER_DO.get(durableObjectId);

			// Forward the request (original or modified for API calls) to the Durable Object instance
			const startTime = Date.now();
			const response = await stub.fetch(actualRequestForDO);
			const duration = Date.now() - startTime;
			
			// Log successful request completion
			if (url.pathname.startsWith(adminPathPrefix) || url.pathname.startsWith(metricsPathPrefix)) {
				console.log(`[Worker] API call completed in ${duration}ms for ${serviceHostnameForDO}: ${response.status}`);
			} else {
				console.log(`[Worker] Request completed in ${duration}ms for ${serviceHostnameForDO}: ${response.status} (Backend: ${response.headers.get('X-CF-Backend-Used') || 'unknown'})`);
			}
			
			return response;

		} catch (e: any) {
			console.error(
				`[Worker Fetch Error] Service: ${serviceHostnameForDO}, Path: ${url.pathname}, Error: ${e.message}`,
				e.stack
			);
			// Generic error for the client
			return new Response("Internal Server Error in Load Balancer Worker.", { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>; // Ensure the exported object matches the Cloudflare Worker handler type
