// Admin panel worker entry point
export default {
  async fetch(request: Request): Promise<Response> {
    // Serve the built admin panel
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('Admin Panel - Under Construction', {
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    return new Response('Not Found', { status: 404 });
    
  }
}; 