import { OAuthUser } from './auth';

/**
 * Frontend module for serving web interfaces using Cloudflare Workers ASSETS binding.
 * This module completely eliminates embedded HTML/CSS/JS code and uses
 * the ASSETS binding to serve static files directly.
 */

// Serve static assets directly via ASSETS binding
export function handleStaticRequest(request: Request, env: Env): Promise<Response> | null {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    // Handle static assets (CSS, JS, etc.)
    if (pathname.startsWith('/css/') || 
        pathname.startsWith('/js/') || 
        pathname.startsWith('/admin/') ||
        pathname.endsWith('.css') || 
        pathname.endsWith('.js') || 
        pathname.endsWith('.html')) {
        return env.ASSETS.fetch(request);
    }
    
    return null;
}

// Template rendering helper
function renderTemplate(templateContent: string, variables: Record<string, string>): string {
    let rendered = templateContent;
    for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        rendered = rendered.split(placeholder).join(value);
    }
    return rendered;
}

// Generate login page with error handling
export async function renderLoginPage(env: Env, error?: string): Promise<Response> {
    try {
        // Fetch the login template from ASSETS
        const templateRequest = new Request('https://example.com/templates/login.html');
        const templateResponse = await env.ASSETS.fetch(templateRequest);
        
        if (!templateResponse.ok) {
            throw new Error('Login template not found');
        }
        
        const template = await templateResponse.text();
        const errorMessage = error ? `<div class="error">${error}</div>` : '';
        
        const html = renderTemplate(template, {
            ERROR_MESSAGE: errorMessage
        });
        
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        console.error('Failed to generate login page:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

// Generate dashboard interface
export async function renderDashboard(user: OAuthUser, env: Env): Promise<Response> {
    try {
        // Fetch the dashboard template from ASSETS
        const templateRequest = new Request('https://example.com/templates/dashboard.html');
        const templateResponse = await env.ASSETS.fetch(templateRequest);
        
        if (!templateResponse.ok) {
            throw new Error('Dashboard template not found');
        }
        
        const template = await templateResponse.text();
        
        const html = renderTemplate(template, {
            USER_NAME: user.name || 'Unknown User',
            USER_EMAIL: user.email || 'unknown@example.com',
            API_SECRET: env.API_SECRET || ''
        });
        
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        console.error('Failed to generate dashboard:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

// Generate control panel interface
export async function renderControlPanel(user: OAuthUser, env: Env): Promise<Response> {
    try {
        // Fetch the control panel template from ASSETS
        const templateRequest = new Request('https://example.com/templates/control-panel.html');
        const templateResponse = await env.ASSETS.fetch(templateRequest);
        
        if (!templateResponse.ok) {
            throw new Error('Control panel template not found');
        }
        
        const template = await templateResponse.text();
        
        const html = renderTemplate(template, {
            USER_NAME: user.name || 'Unknown User',
            USER_EMAIL: user.email || 'unknown@example.com',
            API_SECRET: env.API_SECRET || ''
        });
        
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        console.error('Failed to generate control panel:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

// Generate API documentation interface
export async function renderApiDocs(env: Env): Promise<Response> {
    try {
        // Fetch the API docs template from ASSETS
        const templateRequest = new Request('https://example.com/templates/api-docs.html');
        const templateResponse = await env.ASSETS.fetch(templateRequest);
        
        if (!templateResponse.ok) {
            throw new Error('API docs template not found');
        }
        
        const template = await templateResponse.text();
        
        return new Response(template, {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'public, max-age=3600' // API docs can be cached longer
            }
        });
    } catch (error) {
        console.error('Failed to generate API docs:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

// Health check for frontend module
export function frontendHealthCheck(): { status: string; timestamp: number } {
    return {
        status: 'healthy',
        timestamp: Date.now()
    };
} 