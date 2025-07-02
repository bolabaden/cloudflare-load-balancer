import { LoadBalancerDO } from "./durable-object";
import { 
	basicAuth, 
	authenticateRequest, 
	createJWT, 
	isUserAuthorized, 
	generateRandomState, 
	exchangeGitHubCode, 
	exchangeGoogleCode,
	OAuthUser 
} from "./auth";
import { 
	renderLoginPage, 
	renderDashboard, 
	renderControlPanel, 
	renderApiDocs,
	handleStaticRequest 
} from "./frontend";
import { DashboardRenderer } from "./web/dashboard";
import { ControlPanelRenderer } from "./web/control-panel";
import { APIDocsRenderer } from "./web/api-docs";
import { parseDefaultBackends } from './config';
import { LoadBalancerServiceConfig } from "./types";

/**
 * Cloudflare Workers Load Balancer with OAuth Authentication
 * 
 * A dynamic load balancer that can handle multiple services with different backend configurations.
 * Each service is identified by its hostname and managed by a separate Durable Object instance.
 * Now includes OAuth authentication (GitHub/Google) and a modern web interface.
 */

export { LoadBalancerDO }; // Export the Durable Object class

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const hostname = url.hostname;
		const isWorkerDomain = hostname.endsWith('.workers.dev');
		const adminPathPrefix = '/admin/services/';

		// Default backends are now initialized by the durable object itself
		// No need for worker-level initialization

		// STATIC FILES: serve CSS, JS, and other static assets
		const staticResponse = handleStaticRequest(request, env);
		if (staticResponse) {
			return staticResponse;
		}

		// API DOCUMENTATION: OpenAPI spec endpoint
		if (isWorkerDomain && url.pathname === '/api/openapi.json') {
			const apiDocsRenderer = new APIDocsRenderer();
			const openAPISpec = apiDocsRenderer.generateOpenAPISpec();
			return new Response(JSON.stringify(openAPISpec, null, 2), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=3600'
				}
			});
		}

		// OAUTH ROUTES: only on worker domain
		if (isWorkerDomain && url.pathname.startsWith('/auth/')) {
			return handleAuthRoutes(request, url, env);
		}

		// DEBUG ENDPOINT: temporary for troubleshooting
		if (isWorkerDomain && url.pathname === '/debug-env') {
			return new Response(JSON.stringify({
				DEFAULT_BACKENDS: env.DEFAULT_BACKENDS,
				DEBUG: env.DEBUG
			}, null, 2), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// INITIALIZE SERVICES ENDPOINT: initialize all configured services
		if (isWorkerDomain && url.pathname === '/init-services' && request.method === 'POST') {
			return handleInitializeServices(env);
		}

		// WEB INTERFACE: only on worker domain
		if (isWorkerDomain && env.ENABLE_WEB_INTERFACE === 'true') {
			if (url.pathname === '/' || url.pathname === '/dashboard') {
				return handleWebInterface(request, env, 'dashboard');
			}
			if (url.pathname === '/control-panel') {
				return handleWebInterface(request, env, 'control-panel');
			}
			if (url.pathname === '/api-docs') {
				return handleWebInterface(request, env, 'api-docs');
			}
		}

		// ADMIN API: only on worker domain
		if (isWorkerDomain && url.pathname.startsWith(adminPathPrefix)) {
			return handleAdminAPI(request, url, env, adminPathPrefix);
		}

		// WORKER DOMAIN: Handle other requests to worker domain (favicon, etc.)
		if (isWorkerDomain) {
			// For favicon.ico and other assets, return 404
			if (url.pathname === '/favicon.ico') {
				return new Response('Not Found', { status: 404 });
			}
			
			// For other paths on worker domain, return 404 or redirect to web interface
			if (env.ENABLE_WEB_INTERFACE === 'true') {
				return new Response('', {
					status: 302,
					headers: { 'Location': '/' }
				});
			} else {
				return new Response('Not Found', { status: 404 });
			}
		}

		// ALL OTHER REQUESTS -> Load Balancer (DO)
		const serviceHost = hostname;
		const doId = env.LOAD_BALANCER_DO.idFromName(serviceHost);
		const stub = env.LOAD_BALANCER_DO.get(doId);
		return stub.fetch(request);
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log('Scheduled event triggered:', controller.cron);
		
		// Run health checks for all configured services
		if (env.DEFAULT_BACKENDS) {
			const groups = parseDefaultBackends(env.DEFAULT_BACKENDS);
			for (const group of groups) {
				const { hostname } = group;
				if (hostname) {
					try {
						const doId = env.LOAD_BALANCER_DO.idFromName(hostname);
						const stub = env.LOAD_BALANCER_DO.get(doId);
						
						// Trigger health check
						const healthCheckRequest = new Request('http://localhost/__lb_admin__/health-check', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' }
						});
						
						ctx.waitUntil(stub.fetch(healthCheckRequest));
						console.log(`[Scheduled] Triggered health check for ${hostname}`);
					} catch (error) {
						console.error(`[Scheduled] Failed to trigger health check for ${hostname}:`, error);
					}
				}
			}
		}
	},
} satisfies ExportedHandler<Env>;

async function handleAuthRoutes(request: Request, url: URL, env: Env): Promise<Response> {
	const path = url.pathname;
	const method = request.method;

	// GitHub OAuth initiation
	if (path === '/auth/github' && method === 'GET') {
		const state = generateRandomState();
		// Use consistent redirect URI
		const workerDomain = url.hostname.endsWith('.workers.dev') ? url.hostname : 
			url.hostname.includes('cloudflare-loadbalancer-worker') ? url.hostname : 
			'cloudflare-loadbalancer-worker.bolabaden.workers.dev';
		const redirectUri = `https://${workerDomain}/auth/github/callback`;
		const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email&state=${state}`;
		
		// Store state in cookie for verification
		const response = Response.redirect(githubAuthUrl, 302);
		response.headers.set('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
		return response;
	}

	// GitHub OAuth callback
	if (path === '/auth/github/callback' && method === 'GET') {
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');
		const error = url.searchParams.get('error');
		
		// Verify state parameter
		const cookieHeader = request.headers.get('Cookie');
		const storedState = cookieHeader?.split(';')
			.find(c => c.trim().startsWith('oauth_state='))?.split('=')[1];
		
		if (error) {
			return await renderLoginPage(env, `GitHub authorization error: ${error}`);
		}
		
		if (!code) {
			return await renderLoginPage(env, 'Authorization failed - no code received');
		}

		if (!state || state !== storedState) {
			return await renderLoginPage(env, 'Invalid state parameter');
		}

		const user = await exchangeGitHubCode(code, env);
		if (!user) {
			return await renderLoginPage(env, 'Failed to get user information from GitHub');
		}

		if (!isUserAuthorized(user.email, env.AUTHORIZED_USERS)) {
			return await renderLoginPage(env, `Access denied. Email ${user.email} is not authorized.`);
		}

		const token = await createJWT(user, env.JWT_SECRET);
		return new Response('', {
			status: 302,
			headers: {
				'Location': '/',
				'Set-Cookie': [
					`auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${24 * 60 * 60}`,
					'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
				].join(', ')
			}
		});
	}

	// Google OAuth initiation
	if (path === '/auth/google' && method === 'GET') {
		const state = generateRandomState();
		// Use consistent redirect URI
		const workerDomain = url.hostname.endsWith('.workers.dev') ? url.hostname : 
			url.hostname.includes('cloudflare-loadbalancer-worker') ? url.hostname : 
			'cloudflare-loadbalancer-worker.bolabaden.workers.dev';
		const redirectUri = `https://${workerDomain}/auth/google/callback`;
		const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=email%20profile&response_type=code&state=${state}`;
		
		// Store state in cookie for verification
		const response = Response.redirect(googleAuthUrl, 302);
		response.headers.set('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
		return response;
	}

	// Google OAuth callback
	if (path === '/auth/google/callback' && method === 'GET') {
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');
		const error = url.searchParams.get('error');
		
		// Verify state parameter
		const cookieHeader = request.headers.get('Cookie');
		const storedState = cookieHeader?.split(';')
			.find(c => c.trim().startsWith('oauth_state='))?.split('=')[1];
		
		if (error) {
			return await renderLoginPage(env, `Google authorization error: ${error}`);
		}
		
		if (!code) {
			return await renderLoginPage(env, 'Authorization failed - no code received');
		}

		if (!state || state !== storedState) {
			return await renderLoginPage(env, 'Invalid state parameter');
		}

		// Use consistent redirect URI
		const workerDomain = url.hostname.endsWith('.workers.dev') ? url.hostname : 
			url.hostname.includes('cloudflare-loadbalancer-worker') ? url.hostname : 
			'cloudflare-loadbalancer-worker.bolabaden.workers.dev';
		const redirectUri = `https://${workerDomain}/auth/google/callback`;
		
		const user = await exchangeGoogleCode(code, redirectUri, env);
		if (!user) {
			return await renderLoginPage(env, 'Failed to get user information from Google');
		}

		if (!isUserAuthorized(user.email, env.AUTHORIZED_USERS)) {
			return await renderLoginPage(env, `Access denied. Email ${user.email} is not authorized.`);
		}

		const token = await createJWT(user, env.JWT_SECRET);
		return new Response('', {
			status: 302,
			headers: {
				'Location': '/',
				'Set-Cookie': [
					`auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${24 * 60 * 60}`,
					'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
				].join(', ')
			}
		});
	}

	// Basic auth (backward compatibility)
	if (path === '/auth/basic' && method === 'POST') {
		const formData = await request.formData();
		const username = formData.get('username') as string;
		const password = formData.get('password') as string;

		if (username === env.WEB_AUTH_USERNAME && password === env.WEB_AUTH_PASSWORD) {
			const user: OAuthUser = {
				email: 'admin@local',
				name: 'Admin',
				provider: 'github',
				id: 'local-admin'
			};
			const token = await createJWT(user, env.JWT_SECRET);
			return new Response('', {
				status: 302,
				headers: {
					'Location': '/',
					'Set-Cookie': `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${24 * 60 * 60}`
				}
			});
		} else {
			return await renderLoginPage(env, 'Invalid username or password');
		}
	}

	// Logout
	if (path === '/auth/logout' && method === 'GET') {
		return new Response('', {
			status: 302,
			headers: {
				'Location': '/',
				'Set-Cookie': 'auth_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
			}
		});
	}

	return new Response('Not Found', { status: 404 });
}

async function handleListServices(env: Env): Promise<Response> {
	try {
		const services: Record<string, any> = {};
		
		// Parse default backends from environment
		if (env.DEFAULT_BACKENDS) {
			const groups = parseDefaultBackends(env.DEFAULT_BACKENDS);
			for (const group of groups) {
				const { hostname, backends } = group;
				if (hostname && backends.length > 0) {
					services[hostname] = {
						mode: 'simple',
						backends: backends,
						source: 'default',
						hostname: hostname,
						backendCount: backends.length,
						status: 'active',
						metrics: {
							totalRequests: 0,
							totalSuccessfulRequests: 0,
							totalFailedRequests: 0
						}
					};
					
					// Try to get actual metrics from the DO if it exists
					try {
						const doId = env.LOAD_BALANCER_DO.idFromName(hostname);
						const stub = env.LOAD_BALANCER_DO.get(doId);
						const metricsRequest = new Request('https://dummy/__lb_admin__/metrics', {
							method: 'GET'
						});
						const metricsResponse = await stub.fetch(metricsRequest);
						
						if (metricsResponse.ok) {
							const metrics = await metricsResponse.json();
							services[hostname].metrics = metrics;
							services[hostname].hasLiveData = true;
						}
					} catch (error) {
						console.warn(`Failed to get metrics for ${hostname}:`, error);
						services[hostname].hasLiveData = false;
					}
				}
			}
		}
		
		console.log(`handleListServices: Found ${Object.keys(services).length} services`);
		
		return new Response(JSON.stringify({ 
			services,
			count: Object.keys(services).length,
			timestamp: new Date().toISOString()
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('handleListServices error:', error);
		return new Response(JSON.stringify({ 
			error: 'Failed to list services',
			details: error instanceof Error ? error.message : 'Unknown error'
		}), { 
			status: 500, 
			headers: { 'Content-Type': 'application/json' } 
		});
	}
}

async function handleWebInterface(request: Request, env: Env, page: string = 'dashboard'): Promise<Response> {
	const user = await authenticateRequest(request, env);
	
	if (!user) {
		// Try basic auth for backward compatibility
		if (!basicAuth(request, env.WEB_AUTH_USERNAME, env.WEB_AUTH_PASSWORD)) {
			return await renderLoginPage(env);
		}
	}

	// Use the new modular web interface components
	try {
		// Get a default service configuration for the web interface
		const serviceHost = 'default';
		const doId = env.LOAD_BALANCER_DO.idFromName(serviceHost);
		const stub = env.LOAD_BALANCER_DO.get(doId);
		
		// Get service configuration
		const configRequest = new Request('https://dummy/__lb_admin__/config', {
			method: 'GET'
		});
		const configResponse = await stub.fetch(configRequest);
		let config = null;
		
		if (configResponse.ok) {
			config = await configResponse.json();
		}
		
		// Create a mock engine and config for the web interface
		const mockEngine = {
			getMetrics: () => ({
				totalRequests: 0,
				totalFailedRequests: 0,
				backendMetrics: {}
			})
		} as any;
		
		const mockConfig = config || {
			serviceId: 'default',
			pools: [],
			load_balancer: { 
				steering_policy: 'off',
				enabled: true,
				ttl: 30,
				fallback_pool: null
			},
			currentRoundRobinIndex: 0,
			activeHealthChecks: { 
				enabled: false, 
				interval: 30, 
				timeout: 5, 
				path: '/health',
				type: 'http',
				retries: 3,
				expected_codes: '200',
				expected_body: '',
				follow_redirects: false,
				allow_insecure: false,
				header: {}
			},
			passiveHealthChecks: {
				enabled: false,
				unhealthy_count: 3,
				healthy_count: 2
			},
			geoSteering: {
				enabled: false,
				policy: 'dynamic_latency'
			}
		};

		switch (page) {
			case 'dashboard':
				const dashboardRenderer = new DashboardRenderer(mockEngine, mockConfig as LoadBalancerServiceConfig);
				return await dashboardRenderer.renderDashboard();
			case 'control-panel':
				const controlPanelRenderer = new ControlPanelRenderer(mockEngine, mockConfig as LoadBalancerServiceConfig);
				return await controlPanelRenderer.renderControlPanel();
			case 'api-docs':
				const apiDocsRenderer = new APIDocsRenderer();
				return await apiDocsRenderer.renderAPIDocs();
			default:
				const defaultDashboardRenderer = new DashboardRenderer(mockEngine, mockConfig as LoadBalancerServiceConfig);
				return await defaultDashboardRenderer.renderDashboard();
		}
	} catch (error) {
		console.error('Web interface error:', error);
		// Fallback to basic web interface
		const basicUser: OAuthUser = {
			email: 'admin@local',
			name: 'Admin',
			provider: 'github',
			id: 'local-admin'
		};
		return await renderDashboard(basicUser, env);
	}
}

async function handleAdminAPI(request: Request, url: URL, env: Env, adminPathPrefix: string): Promise<Response> {
	// Extract service hostname and operation
	const pathAfter = url.pathname.slice(adminPathPrefix.length);
	const [serviceHost, ...ops] = pathAfter.split('/').filter(Boolean);
	
	// Special case: list all services
	if (serviceHost === 'list' && request.method === 'GET') {
		return handleListServices(env);
	}
	
	if (!serviceHost || ops.length === 0) {
		return new Response(JSON.stringify({ error: 'Invalid API path' }), { 
			status: 400, 
			headers: { 'Content-Type': 'application/json' } 
		});
	}

	// Prepare DO request
	const operation = ops.join('/');
	const doUrl = new URL(request.url);
	doUrl.pathname = `/__lb_admin__/${operation}`;
	const doRequest = new Request(doUrl.toString(), request);

	// Authenticate
	const authHeader = request.headers.get('Authorization');
	
	// Try OAuth authentication first
	const user = await authenticateRequest(request, env);
	if (user && isUserAuthorized(user.email, env.AUTHORIZED_USERS)) {
		// OAuth user is authorized, proceed to DO
		const doId = env.LOAD_BALANCER_DO.idFromName(serviceHost);
		const stub = env.LOAD_BALANCER_DO.get(doId);
		return stub.fetch(doRequest);
	}

	// Try basic auth (web interface)
	if (authHeader?.startsWith('Basic ')) {
		if (env.ENABLE_WEB_INTERFACE !== 'true' || !basicAuth(request, env.WEB_AUTH_USERNAME, env.WEB_AUTH_PASSWORD)) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
				status: 401, 
				headers: { 'Content-Type': 'application/json' } 
			});
		}
	} 
	// Try Bearer token (API)
	else if (authHeader?.startsWith('Bearer ')) {
		if (authHeader !== `Bearer ${env.API_SECRET}`) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
				status: 401, 
				headers: { 'Content-Type': 'application/json' } 
			});
		}
	} else {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
			status: 401, 
			headers: { 'Content-Type': 'application/json' } 
		});
	}

	// Route to DO
	const doId = env.LOAD_BALANCER_DO.idFromName(serviceHost);
	const stub = env.LOAD_BALANCER_DO.get(doId);
	return stub.fetch(doRequest);
}

async function handleInitializeServices(env: Env): Promise<Response> {
	try {
		if (env.DEFAULT_BACKENDS) {
			const groups = parseDefaultBackends(env.DEFAULT_BACKENDS);
			for (const group of groups) {
				const { hostname, backends } = group;
				if (hostname && backends.length > 0) {
					const doId = env.LOAD_BALANCER_DO.idFromName(hostname);
					const stub = env.LOAD_BALANCER_DO.get(doId);
					
					// Initialize service
					const serviceRequest = new Request('https://dummy/__lb_admin__/initialize', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							hostname: hostname,
							backends: backends,
							mode: 'simple',
							source: 'default'
						})
					});
					
					await stub.fetch(serviceRequest);
					console.log(`[Initialize] Initialized service ${hostname}`);
				}
			}
		}
		
		return new Response(JSON.stringify({ 
			message: 'Services initialized successfully'
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('handleInitializeServices error:', error);
		return new Response(JSON.stringify({ 
			error: 'Failed to initialize services',
			details: error instanceof Error ? error.message : 'Unknown error'
		}), { 
			status: 500, 
			headers: { 'Content-Type': 'application/json' } 
		});
	}
}
