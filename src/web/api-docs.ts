export class APIDocsRenderer {
  async renderAPIDocs(): Promise<Response> {
    // Serve the static HTML template
    const template = this.getStaticTemplate();
    return new Response(template, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  }

  private getStaticTemplate(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Balancer API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui.css" />
    <link rel="stylesheet" href="/css/dashboard.css">
    <style>
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info { margin: 20px 0; }
        .api-header {
            background: var(--primary-color);
            color: white;
            padding: 20px;
            margin-bottom: 20px;
        }
        .api-header h1 { margin: 0; }
        .api-description { margin-top: 10px; opacity: 0.9; }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="nav-brand">
            <h1>Load Balancer API Documentation</h1>
        </div>
        <div class="nav-links">
            <a href="/dashboard" class="nav-link">Dashboard</a>
            <a href="/control-panel" class="nav-link">Control Panel</a>
            <a href="/api-docs" class="nav-link active">API Docs</a>
        </div>
    </nav>
    <main class="main-content">
        <div class="api-header">
            <h1>Load Balancer API</h1>
            <div class="api-description">
                Comprehensive API documentation for managing and monitoring the Cloudflare Load Balancer service.
                Use this API to configure backends, monitor health, and retrieve metrics.
            </div>
        </div>
        <div id="swagger-ui"></div>
    </main>
    <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            const ui = SwaggerUIBundle({
                url: '/api/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout",
                validatorUrl: null,
                tryItOutEnabled: true,
                supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
                onComplete: function() {
                    console.log('Swagger UI loaded successfully');
                },
                onFailure: function(error) {
                    console.error('Failed to load Swagger UI:', error);
                    document.getElementById('swagger-ui').innerHTML = \`
                        <div style="text-align: center; padding: 40px;">
                            <h3>API Documentation Unavailable</h3>
                            <p>Unable to load the OpenAPI specification. Please ensure the service is running.</p>
                            <p>Error: \${error.message || 'Unknown error'}</p>
                        </div>
                    \`;
                }
            });
        };
    </script>
</body>
</html>`;
  }

  private generateAPIDocsHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Balancer API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui.css" />
    <link rel="stylesheet" href="/css/dashboard.css">
    <style>
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info { margin: 20px 0; }
      .api-header {
        background: #1a202c;
        color: white;
        padding: 20px;
        margin-bottom: 20px;
      }
      .api-header nav a {
        color: #cbd5e0;
        text-decoration: none;
        margin-right: 20px;
      }
      .api-header nav a:hover {
        color: white;
      }
    </style>
</head>
<body>
    <div class="api-header">
        <h1>Load Balancer API Documentation</h1>
        <nav>
            <a href="/">Dashboard</a>
            <a href="/docs">API Docs</a>
            <a href="/admin">Control Panel</a>
        </nav>
    </div>
    
    <div id="swagger-ui"></div>
    
    <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = function() {
        const ui = SwaggerUIBundle({
          url: '/api/openapi.json',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset
          ],
          plugins: [
            SwaggerUIBundle.plugins.DownloadUrl
          ],
          layout: "StandaloneLayout"
        });
      };
    </script>
</body>
</html>`;
  }

  generateOpenAPISpec(): object {
    return {
      openapi: "3.0.0",
      info: {
        title: "Cloudflare Load Balancer API",
        description: "API for managing load balancer configurations, backends, and monitoring",
        version: "1.0.0"
      },
      servers: [
        {
          url: "/admin/services",
          description: "Load Balancer Admin API"
        }
      ],
      paths: {
        "/": {
          get: {
            summary: "List all services",
            description: "Retrieve a list of all configured load balancer services",
            responses: {
              "200": {
                description: "List of services",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Service" }
                    }
                  }
                }
              }
            }
          }
        },
        "/{serviceName}": {
          get: {
            summary: "Get service configuration",
            description: "Retrieve configuration for a specific service",
            parameters: [
              {
                name: "serviceName",
                in: "path",
                required: true,
                schema: { type: "string" },
                description: "Name of the service"
              }
            ],
            responses: {
              "200": {
                description: "Service configuration",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ServiceConfig" }
                  }
                }
              }
            }
          },
          put: {
            summary: "Update service configuration",
            description: "Update the configuration for a specific service",
            parameters: [
              {
                name: "serviceName",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ServiceConfig" }
                }
              }
            },
            responses: {
              "200": {
                description: "Configuration updated successfully"
              }
            }
          }
        },
        "/{serviceName}/backends": {
          get: {
            summary: "List service backends",
            description: "Get all backends for a specific service",
            parameters: [
              {
                name: "serviceName",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            responses: {
              "200": {
                description: "List of backends",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Backend" }
                    }
                  }
                }
              }
            }
          },
          post: {
            summary: "Add backend",
            description: "Add a new backend to the service",
            parameters: [
              {
                name: "serviceName",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Backend" }
                }
              }
            },
            responses: {
              "201": {
                description: "Backend added successfully"
              }
            }
          }
        },
        "/{serviceName}/backends/{backendId}": {
          delete: {
            summary: "Remove backend",
            description: "Remove a backend from the service",
            parameters: [
              {
                name: "serviceName",
                in: "path",
                required: true,
                schema: { type: "string" }
              },
              {
                name: "backendId",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            responses: {
              "204": {
                description: "Backend removed successfully"
              }
            }
          }
        },
        "/{serviceName}/metrics": {
          get: {
            summary: "Get service metrics",
            description: "Retrieve performance metrics for a service",
            parameters: [
              {
                name: "serviceName",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            responses: {
              "200": {
                description: "Service metrics",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Metrics" }
                  }
                }
              }
            }
          }
        },
        "/{serviceName}/health-check": {
          post: {
            summary: "Trigger health check",
            description: "Manually trigger a health check for all backends",
            parameters: [
              {
                name: "serviceName",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            responses: {
              "200": {
                description: "Health check completed"
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Service: {
            type: "object",
            properties: {
              name: { type: "string" },
              hostname: { type: "string" },
              status: { type: "string" },
              backendCount: { type: "number" }
            }
          },
          ServiceConfig: {
            type: "object",
            properties: {
              name: { type: "string" },
              algorithm: { type: "string", enum: ["round-robin", "weighted", "least-connections"] },
              healthCheck: {
                type: "object",
                properties: {
                  enabled: { type: "boolean" },
                  interval: { type: "number" },
                  timeout: { type: "number" },
                  path: { type: "string" }
                }
              },
              pools: {
                type: "array",
                items: { $ref: "#/components/schemas/Pool" }
              }
            }
          },
          Pool: {
            type: "object",
            properties: {
              name: { type: "string" },
              backends: {
                type: "array",
                items: { $ref: "#/components/schemas/Backend" }
              }
            }
          },
          Backend: {
            type: "object",
            properties: {
              url: { type: "string" },
              weight: { type: "number", default: 1 },
              healthy: { type: "boolean" },
              lastHealthCheck: { type: "string", format: "date-time" }
            }
          },
          Metrics: {
            type: "object",
            properties: {
              totalRequests: { type: "number" },
              totalFailedRequests: { type: "number" },
              averageResponseTime: { type: "number" },
              backendMetrics: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    requestCount: { type: "number" },
                    failureCount: { type: "number" },
                    totalResponseTimeMs: { type: "number" }
                  }
                }
              }
            }
          }
        }
      }
    };
  }
} 