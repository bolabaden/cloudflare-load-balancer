// Augment Env interface to include all environment variables
declare namespace Cloudflare {
	interface Env {
		DEBUG: string;
		ENVIRONMENT: string;
		DEFAULT_BACKENDS: string;
		API_SECRET: string;
		LOAD_BALANCER_DO: DurableObjectNamespace;
	}
}

interface Env extends Cloudflare.Env {} 