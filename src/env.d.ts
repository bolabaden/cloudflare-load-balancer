// Augment Env interface to include all environment variables
declare namespace Cloudflare {
  interface Env {
    DEBUG: string;
    ENVIRONMENT: string;
    CLOUDFLARE_API_KEY: string;
    CLOUDFLARE_API_TOKEN: string;
    CLOUDFLARE_EMAIL: string;
    CLOUDFLARE_ZONE_ID: string;
    DEFAULT_BACKENDS: string;
    ENABLE_WEB_INTERFACE: string;
    WEB_AUTH_USERNAME: string;
    WEB_AUTH_PASSWORD: string;
    API_SECRET: string;
    // OAuth Configuration
    JWT_SECRET: string;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    AUTHORIZED_USERS: string;
    // Durable Objects
    LOAD_BALANCER_DO: DurableObjectNamespace;
  }
}

interface Env extends Cloudflare.Env {} 