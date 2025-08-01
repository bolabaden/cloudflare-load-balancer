// Augment Env interface to include all environment variables
declare namespace Cloudflare {
	interface Env {
		DEBUG: string;
		ENVIRONMENT: string;
		DEFAULT_BACKENDS: string;
		API_SECRET: string;
		FORCE_ENV: string;
		DNS_FIRST: string;
		DNS_FIRST_TIMEOUT_MS?: string;
		DNS_FIRST_FAILURE_STATUS_CODES?: string;
		DNS_FIRST_MAX_RESPONSE_TIME_MS?: string;
		SSL_SKIP_CERTIFICATE_VERIFICATION?: string;
		SSL_ALLOW_SELF_SIGNED_CERTIFICATES?: string;
		SSL_SKIP_HOSTNAME_VERIFICATION?: string;
		LOAD_BALANCER_DO: DurableObjectNamespace;
	}
}

interface Env extends Cloudflare.Env {} 