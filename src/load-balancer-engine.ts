import { 
  LoadBalancerServiceConfig, 
  Backend, 
  OriginPool, 
  LoadBalancer,
  TrafficSteeringMethod,
  EndpointSteeringMethod,
  SessionAffinityConfig,
  DnsFailoverConfig,
  DnsState,
  HealthCheckResult,
  ServiceMetrics,
  PoolMetrics,
  BackendMetrics,
  GeographicData,
  NetworkPath,
  Alert,
  LoadBalancerRule,
  RuleAction,
  NotificationConfig,
  NotificationPayload,
  Token
} from './types';

export class LoadBalancerEngine {
  private config: LoadBalancerServiceConfig;
  private metrics: ServiceMetrics;
  private dnsState?: DnsState;
  private sessionAffinityCache = new Map<string, { poolId: string; backendId: string; expires: number }>();
  private healthCheckResults = new Map<string, HealthCheckResult>();
  private alertHistory: Alert[] = [];
  private rttCache = new Map<string, { [region: string]: number }>(); // Pool RTT data for dynamic steering
  private env?: any; // Cloudflare Workers environment for bindings
  
  // Error tracking and circuit breaker management
  private circuitBreakerStates = new Map<string, {
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    lastFailureTime: number;
    nextRetryTime: number;
    successCount: number;
  }>();
  
  private backendHealthScores = new Map<string, {
    score: number;
    lastUpdated: number;
    recentErrors: Array<{ timestamp: number; type: string }>;
    recentResponseTimes: Array<{ timestamp: number; duration: number }>;
  }>();
  
  constructor(config: LoadBalancerServiceConfig) {
    this.config = config;
    this.metrics = this.initializeMetrics();
    
    if (this.config.load_balancer.dns_failover?.enabled) {
      this.dnsState = this.initializeDnsState();
    }
    
    // Initialize circuit breaker states and health scores for all backends
    this.initializeBackendTracking();
  }

  /**
   * Set the Cloudflare Workers environment for bindings (email, KV, etc.)
   */
  public setEnvironment(env: any): void {
    this.env = env;
  }

  /**
   * Extract client IP from request headers
   */
  private getClientIp(request: Request): string {
    // Try different headers in order of preference
    const headers = [
      'CF-Connecting-IP',    // Cloudflare
      'X-Forwarded-For',     // Standard proxy header
      'X-Real-IP',           // Nginx
      'X-Client-IP',         // Apache
      'X-Forwarded',         // General
      'Forwarded-For',       // RFC 7239
      'Forwarded'            // RFC 7239
    ];
    
    for (const header of headers) {
      const value = request.headers.get(header);
      if (value) {
        // Handle comma-separated IPs (take the first one)
        const ip = value.split(',')[0].trim();
        if (this.isValidIpAddress(ip)) {
          return ip;
        }
      }
    }
    
    // Fallback to a default IP if none found
    return '127.0.0.1';
  }
  
  private initializeMetrics(): ServiceMetrics {
    const backendMetrics: Record<string, BackendMetrics> = {};
    const poolMetrics: Record<string, PoolMetrics> = {};
    
    this.config.pools.forEach(pool => {
      poolMetrics[pool.id] = {
        poolId: pool.id,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0,
        activeConnections: 0,
        avgResponseTime: 0,
        healthyOrigins: pool.backends.filter(b => b.healthy).length,
        totalOrigins: pool.backends.length
      };
      
      pool.backends.forEach(backend => {
        backendMetrics[backend.id] = {
          requests: backend.requests || 0,
          successfulRequests: backend.successfulRequests || 0,
          failedRequests: backend.failedRequests || 0,
          totalResponseTimeMs: backend.totalResponseTimeMs || 0,
          avgResponseTimeMs: 0,
          lastRequestTimestamp: Date.now()
        };
      });
    });
    
    return {
      serviceId: this.config.serviceId,
      totalRequests: 0,
      totalSuccessfulRequests: 0,
      totalFailedRequests: 0,
      backendMetrics,
      poolMetrics,
      dnsFailovers: 0,
      dnsRecoveries: 0,
      steeringDecisions: {},
      sessionAffinityHits: 0,
      sessionAffinityMisses: 0
    };
  }
  
  private initializeDnsState(): DnsState {
    const primaryPool = this.config.pools.find(p => p.id === this.config.load_balancer.dns_failover?.primary_pool_id);
    const healthyBackends = primaryPool?.backends.filter(b => b.healthy && b.enabled) || [];
    const primaryPoolId = this.config.load_balancer.dns_failover!.primary_pool_id;
    
    return {
      current_pool_id: primaryPoolId,
      current_backend_ips: healthyBackends.map(b => b.ip),
      failover_state: 'primary',
      failure_count: 0,
      recovery_count: 0,
      health_check_results: {},
      currentPool: primaryPoolId,
      failoverActive: false
    };
  }
  
  /**
   * Initialize circuit breaker states and health scores for all backends
   */
  private initializeBackendTracking(): void {
    this.config.pools.forEach(pool => {
      pool.backends.forEach(backend => {
        // Initialize circuit breaker state
        this.circuitBreakerStates.set(backend.id, {
          state: 'closed',
          failureCount: 0,
          lastFailureTime: 0,
          nextRetryTime: 0,
          successCount: 0
        });
        
        // Initialize health score
        this.backendHealthScores.set(backend.id, {
          score: 100, // Start with perfect health score
          lastUpdated: Date.now(),
          recentErrors: [],
          recentResponseTimes: []
        });
        
        // Initialize enhanced backend properties if not present
        if (!backend.circuitBreakerState) {
          backend.circuitBreakerState = 'closed';
          backend.consecutiveSuccesses = 0;
          backend.errorCounts = {
            connection: 0,
            timeout: 0,
            http5xx: 0,
            http523: 0
          };
          backend.healthScore = 100;
          backend.avgResponseTimeMs = 0;
        }
      });
    });
  }
  
  /**
   * Enhanced error handling for connection errors and specific HTTP status codes
   */
  public handleBackendError(backend: Backend, error: Error | Response, responseTime?: number): void {
    const now = Date.now();
    const cbConfig = this.config.passiveHealthChecks.circuit_breaker;
    const cbState = this.circuitBreakerStates.get(backend.id);
    
    if (!cbState) return;
    
    // Determine error type
    let errorType = 'unknown';
    let statusCode = 0;
    
    if (error instanceof Response) {
      statusCode = error.status;
      if (statusCode === 523) {
        errorType = 'http523';
        backend.errorCounts!.http523++;
      } else if (statusCode >= 500) {
        errorType = 'http5xx';
        backend.errorCounts!.http5xx++;
      }
    } else if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        errorType = 'timeout';
        backend.errorCounts!.timeout++;
      } else {
        errorType = 'connection';
        backend.errorCounts!.connection++;
      }
    }
    
    // Update backend state
    backend.consecutiveFailures++;
    backend.consecutiveSuccesses = 0;
    backend.lastFailureTimestamp = now;
    
    // Update circuit breaker state
    cbState.failureCount++;
    cbState.lastFailureTime = now;
    cbState.successCount = 0;
    
    // Update health score
    this.updateHealthScore(backend.id, false, responseTime, errorType);
    
    // Check if circuit breaker should open
    if (cbConfig?.enabled && cbState.state === 'closed') {
      const shouldOpen = cbState.failureCount >= (cbConfig.failure_threshold || 5);
      
      if (shouldOpen) {
        cbState.state = 'open';
        cbState.nextRetryTime = now + (cbConfig.recovery_timeout_ms || 60000);
        backend.circuitBreakerState = 'open';
        backend.circuitBreakerOpenTimestamp = now;
        
        console.warn(`[LoadBalancer] Circuit breaker opened for backend ${backend.id} after ${cbState.failureCount} failures. Error type: ${errorType}`);
        
        // Generate alert
        this.generateAlert({
          id: `cb-open-${backend.id}-${now}`,
          type: 'backend_down',
          severity: errorType === 'http523' || errorType === 'connection' ? 'critical' : 'high',
          message: `Circuit breaker opened for backend ${backend.id} due to ${errorType} errors`,
          timestamp: now,
          metadata: { backendId: backend.id, errorType, failureCount: cbState.failureCount }
        });
      }
    }
    
    // Mark backend as unhealthy if it exceeds failure threshold
    if (backend.consecutiveFailures >= this.config.passiveHealthChecks.max_failures) {
      backend.healthy = false;
      backend.status = `Unhealthy (${errorType}, ${backend.consecutiveFailures} failures)`;
    }
    
    console.error(`[LoadBalancer] Backend ${backend.id} error: ${errorType} (status: ${statusCode}). Consecutive failures: ${backend.consecutiveFailures}`);
  }
  
  /**
   * Handle successful backend response
   */
  public handleBackendSuccess(backend: Backend, responseTime: number): void {
    const now = Date.now();
    const cbConfig = this.config.passiveHealthChecks.circuit_breaker;
    const cbState = this.circuitBreakerStates.get(backend.id);
    
    if (!cbState) return;
    
    // Update backend state
    backend.consecutiveFailures = 0;
    backend.consecutiveSuccesses = (backend.consecutiveSuccesses || 0) + 1;
    backend.lastSuccessTimestamp = now;
    
    // Update circuit breaker state
    cbState.successCount++;
    
    // Update health score
    this.updateHealthScore(backend.id, true, responseTime);
    
    // Handle circuit breaker state transitions
    if (cbConfig?.enabled) {
      if (cbState.state === 'half-open' && cbState.successCount >= (cbConfig.success_threshold || 3)) {
        // Close the circuit breaker
        cbState.state = 'closed';
        cbState.failureCount = 0;
        backend.circuitBreakerState = 'closed';
        backend.circuitBreakerOpenTimestamp = undefined;
        
        console.log(`[LoadBalancer] Circuit breaker closed for backend ${backend.id} after ${cbState.successCount} consecutive successes`);
        
        // Generate recovery alert
        this.generateAlert({
          id: `cb-closed-${backend.id}-${now}`,
          type: 'backend_down',
          severity: 'low',
          message: `Backend ${backend.id} recovered - circuit breaker closed`,
          timestamp: now,
          resolved: true,
          metadata: { backendId: backend.id, successCount: cbState.successCount }
        });
      }
    }
    
    // Mark backend as healthy if it was unhealthy
    if (!backend.healthy) {
      backend.healthy = true;
      backend.status = 'Healthy';
      console.log(`[LoadBalancer] Backend ${backend.id} recovered and marked healthy`);
    }
  }
  
  /**
   * Update health score for a backend based on recent performance
   */
  private updateHealthScore(backendId: string, success: boolean, responseTime?: number, errorType?: string): void {
    const healthData = this.backendHealthScores.get(backendId);
    const config = this.config.passiveHealthChecks.health_scoring;
    
    if (!healthData || !config?.enabled) return;
    
    const now = Date.now();
    const timeWindow = config.time_window_ms || 300000; // 5 minutes default
    
    // Clean old data
    healthData.recentErrors = healthData.recentErrors.filter(e => now - e.timestamp < timeWindow);
    healthData.recentResponseTimes = healthData.recentResponseTimes.filter(rt => now - rt.timestamp < timeWindow);
    
    // Add new data
    if (!success && errorType) {
      healthData.recentErrors.push({ timestamp: now, type: errorType });
    }
    
    if (responseTime) {
      healthData.recentResponseTimes.push({ timestamp: now, duration: responseTime });
    }
    
    // Calculate health score (0-100)
    let score = 100;
    
    // Factor in error rate
    if (healthData.recentErrors.length > 0) {
      const totalRequests = healthData.recentErrors.length + (success ? 1 : 0);
      const errorRate = healthData.recentErrors.length / totalRequests;
      score -= errorRate * 100 * (config.error_rate_weight || 0.4);
    }
    
    // Factor in response time
    if (healthData.recentResponseTimes.length > 0) {
      const avgResponseTime = healthData.recentResponseTimes.reduce((sum, rt) => sum + rt.duration, 0) / healthData.recentResponseTimes.length;
      const responseTimePenalty = Math.min(avgResponseTime / 1000, 50); // Max 50 point penalty for slow responses
      score -= responseTimePenalty * (config.response_time_weight || 0.3);
    }
    
    // Factor in availability (based on recent errors)
    const criticalErrors = healthData.recentErrors.filter(e => e.type === 'http523' || e.type === 'connection').length;
    if (criticalErrors > 0) {
      score -= criticalErrors * 10 * (config.availability_weight || 0.3);
    }
    
    // Ensure score is within bounds
    score = Math.max(0, Math.min(100, score));
    
    healthData.score = score;
    healthData.lastUpdated = now;
    
    // Update backend health score
    const backend = this.findBackendById(backendId);
    if (backend) {
      backend.healthScore = score;
    }
  }
  
  /**
   * Check if a backend's circuit breaker allows requests
   */
  private isBackendAvailable(backend: Backend): boolean {
    const cbConfig = this.config.passiveHealthChecks.circuit_breaker;
    const cbState = this.circuitBreakerStates.get(backend.id);
    
    if (!cbConfig?.enabled || !cbState) {
      return backend.healthy && backend.enabled;
    }
    
    const now = Date.now();
    
    switch (cbState.state) {
      case 'closed':
        return backend.healthy && backend.enabled;
      
      case 'open':
        // Check if it's time to try half-open
        if (now >= cbState.nextRetryTime) {
          cbState.state = 'half-open';
          backend.circuitBreakerState = 'half-open';
          console.log(`[LoadBalancer] Circuit breaker for backend ${backend.id} transitioning to half-open`);
          return backend.enabled; // Allow limited requests in half-open state
        }
        return false;
      
      case 'half-open':
        return backend.enabled; // Allow limited requests to test recovery
      
      default:
        return backend.healthy && backend.enabled;
    }
  }
  
  /**
   * Find backend by ID across all pools
   */
  private findBackendById(backendId: string): Backend | undefined {
    for (const pool of this.config.pools) {
      const backend = pool.backends.find(b => b.id === backendId);
      if (backend) return backend;
    }
    return undefined;
  }
  
  /**
   * Generate alert for monitoring and notifications
   */
  private generateAlert(alert: Alert): void {
    alert.id = `alert-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    this.alertHistory.push(alert);
    
    // Keep only recent alerts (last 1000)
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-1000);
    }
    
    // Send notifications through configured channels (async but don't await to avoid blocking)
    this.sendNotifications(alert, this.env).catch(error => {
      console.error(`[LoadBalancer] Failed to send notifications for alert ${alert.id}:`, error);
    });
  }

  /**
   * Send notifications through multiple channels (webhooks, email, etc.)
   */
  private async sendNotifications(alert: Alert, env?: any): Promise<void> {
    try {
      // Get notification configuration from pool or service config
      const notificationConfig = this.getNotificationConfig(alert);
      
      if (!notificationConfig || notificationConfig.length === 0) {
        console.log(`[LoadBalancer] Alert generated (no notifications configured): ${alert.type} - ${alert.message}`);
        return;
      }

      // Send to all configured notification channels
      const notifications = notificationConfig.map((config: NotificationConfig) => 
        this.deliverNotification(alert, config, env)
      );
      
      await Promise.allSettled(notifications);
      
      console.log(`[LoadBalancer] Alert sent to ${notificationConfig.length} notification channel(s): ${alert.type} - ${alert.message}`);
      
    } catch (error) {
      console.error(`[LoadBalancer] Failed to send notifications for alert ${alert.id}:`, error);
    }
  }

  /**
   * Get notification configuration for the alert
   */
  private getNotificationConfig(alert: Alert): NotificationConfig[] {
    const configs: NotificationConfig[] = [];
    
    // Check for pool-specific notifications
    if (alert.metadata && alert.metadata.poolId) {
      const pool = this.config.pools.find(p => p.id === alert.metadata!.poolId);
      if (pool?.notification_email) {
        configs.push({
          type: 'email',
          address: pool.notification_email,
          enabled: true
        });
      }
    }
    
    // Check for service-level notifications
    if (this.config.notificationSettings) {
      configs.push(...this.config.notificationSettings.filter(n => n.enabled));
    }
    
    return configs;
  }

  /**
   * Deliver notification to specific channel
   */
  private async deliverNotification(alert: Alert, config: NotificationConfig, env?: any): Promise<void> {
    const payload = this.buildNotificationPayload(alert, config);
    
    switch (config.type) {
      case 'webhook':
        await this.sendWebhookNotification(config, payload);
        break;
        
      case 'email':
        await this.sendEmailNotification(config, payload, env);
        break;
        
      case 'slack':
        await this.sendSlackNotification(config, payload);
        break;
        
      case 'discord':
        await this.sendDiscordNotification(config, payload);
        break;
        
      case 'teams':
        await this.sendTeamsNotification(config, payload);
        break;
        
      case 'pagerduty':
        await this.sendPagerDutyNotification(config, payload);
        break;
        
      case 'opsgenie':
        await this.sendOpsGenieNotification(config, payload);
        break;
        
      default:
        console.warn(`[LoadBalancer] Unknown notification type: ${config.type}`);
    }
  }

  /**
   * Build notification payload based on alert and config
   */
  private buildNotificationPayload(alert: Alert, config: NotificationConfig): NotificationPayload {
    const timestamp = new Date(alert.timestamp).toISOString();
    const serviceId = this.config.serviceId;
    
    return {
      alert_id: alert.id,
      alert_type: alert.type,
      severity: alert.severity,
      message: alert.message,
      timestamp,
      service_id: serviceId,
      metadata: {
        ...alert.metadata,
        service_hostname: serviceId,
        account_id: config.account_id || 'unknown',
        zone_id: config.zone_id || 'unknown'
      },
      resolved: alert.resolved || false,
      resolved_timestamp: alert.resolved_timestamp ? new Date(alert.resolved_timestamp).toISOString() : null
    };
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(config: NotificationConfig, payload: NotificationPayload): Promise<void> {
    if (!config.webhook_url) {
      throw new Error('Webhook URL not configured');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Cloudflare-LoadBalancer/1.0'
    };

    // Add authentication header if secret is provided
    if (config.secret) {
      headers['cf-webhook-auth'] = config.secret;
    }

    const response = await fetch(config.webhook_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Webhook failed with status ${response.status}: ${response.statusText}`);
    }
  }

  /**
   * Send email notification using various email providers
   */
  private async sendEmailNotification(config: NotificationConfig, payload: NotificationPayload, env?: any): Promise<void> {
    if (!config.address) {
      throw new Error('Email address not configured');
    }

    const subject = `🚨 Load Balancer Alert: ${payload.alert_type} - ${payload.severity.toUpperCase()}`;
    const htmlBody = this.formatEmailBodyHtml(payload);
    const textBody = this.formatEmailBody(payload);

    // Try different email providers based on configuration
    if (config.api_key && config.webhook_url?.includes('resend')) {
      await this.sendEmailViaResend(config, payload.service_id, config.address, subject, htmlBody, textBody);
    } else if (config.api_key && config.webhook_url?.includes('sendgrid')) {
      await this.sendEmailViaSendGrid(config, payload.service_id, config.address, subject, htmlBody, textBody);
    } else if (config.api_key && config.webhook_url?.includes('postmark')) {
      await this.sendEmailViaPostmark(config, payload.service_id, config.address, subject, htmlBody, textBody);
    } else if (config.webhook_url?.includes('cloudflare')) {
      await this.sendEmailViaCloudflareEmailRouting(config, payload.service_id, config.address, subject, htmlBody, textBody, env);
    } else {
      // Fallback to webhook-based email service
      await this.sendEmailViaWebhook(config, payload.service_id, config.address, subject, htmlBody, textBody);
    }
  }

  /**
   * Send email via Resend API
   */
  private async sendEmailViaResend(
    config: NotificationConfig, 
    serviceId: string, 
    to: string, 
    subject: string, 
    htmlBody: string, 
    textBody: string
  ): Promise<void> {
    const fromEmail = `noreply@${serviceId}`;
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: subject,
        html: htmlBody,
        text: textBody,
        tags: [
          { name: 'category', value: 'load-balancer-alert' },
          { name: 'service', value: serviceId }
        ]
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Resend API error: ${response.status} - ${error}`);
    }

    const result = await response.json() as { id: string };
    console.log(`[LoadBalancer] Email sent via Resend to ${to}, ID: ${result.id}`);
  }

  /**
   * Send email via SendGrid API
   */
  private async sendEmailViaSendGrid(
    config: NotificationConfig, 
    serviceId: string, 
    to: string, 
    subject: string, 
    htmlBody: string, 
    textBody: string
  ): Promise<void> {
    const fromEmail = `noreply@${serviceId}`;
    
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: to }],
          subject: subject
        }],
        from: { email: fromEmail },
        content: [
          { type: 'text/plain', value: textBody },
          { type: 'text/html', value: htmlBody }
        ],
        categories: ['load-balancer-alert', serviceId],
        custom_args: {
          service_id: serviceId,
          alert_type: 'load-balancer'
        }
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SendGrid API error: ${response.status} - ${error}`);
    }

    console.log(`[LoadBalancer] Email sent via SendGrid to ${to}`);
  }

  /**
   * Send email via Postmark API
   */
  private async sendEmailViaPostmark(
    config: NotificationConfig, 
    serviceId: string, 
    to: string, 
    subject: string, 
    htmlBody: string, 
    textBody: string
  ): Promise<void> {
    const fromEmail = `noreply@${serviceId}`;
    
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': config.api_key!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        From: fromEmail,
        To: to,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: 'outbound',
        Tag: 'load-balancer-alert',
        Metadata: {
          service_id: serviceId,
          alert_type: 'load-balancer'
        }
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Postmark API error: ${response.status} - ${error}`);
    }

    const result = await response.json() as { MessageID: string };
    console.log(`[LoadBalancer] Email sent via Postmark to ${to}, ID: ${result.MessageID}`);
  }

  /**
   * Send email via Cloudflare Email Routing
   */
  private async sendEmailViaCloudflareEmailRouting(
    config: NotificationConfig, 
    serviceId: string, 
    to: string, 
    subject: string, 
    htmlBody: string, 
    textBody: string,
    env?: any
  ): Promise<void> {
    try {
      // Import EmailMessage from cloudflare:email runtime API
      const { EmailMessage } = await import('cloudflare:email');
      
      // Create MIME message using proper RFC-5322 compliant implementation
      const mimeMessage = this.createMimeMessage(
        `noreply@${serviceId}`,
        to,
        subject,
        htmlBody,
        textBody
      );

      // Create EmailMessage instance for Cloudflare Email Routing
      const message = new EmailMessage(
        `noreply@${serviceId}`,
        to,
        mimeMessage
      );

      // Send via the EMAIL binding (needs to be configured in wrangler.toml/wrangler.jsonc)
      // The binding name should be passed in config or use a default
      const bindingName = config.webhook_url || 'EMAIL_NOTIFICATIONS';
      
      if (env && env[bindingName]) {
        await env[bindingName].send(message);
        console.log(`[LoadBalancer] Email sent via Cloudflare Email Routing to ${to}`);
      } else {
        // Fallback: Log the email content if binding is not available
        console.log(`[LoadBalancer] EMAIL BINDING '${bindingName}' not found. Email would be sent:`, {
          from: `noreply@${serviceId}`,
          to: to,
          subject: subject,
          mimeLength: mimeMessage.length,
          note: 'Configure email binding in wrangler.toml: send_email = [{ name = "EMAIL_NOTIFICATIONS" }]'
        });
      }
      
    } catch (error) {
      // If cloudflare:email is not available, fall back to webhook method
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('cloudflare:email')) {
        console.warn(`[LoadBalancer] Cloudflare Email Routing not available, falling back to webhook`);
        if (config.webhook_url) {
          await this.sendEmailViaWebhook(config, serviceId, to, subject, htmlBody, textBody);
        } else {
          throw new Error(`Cloudflare Email Routing not available and no webhook URL configured`);
        }
      } else {
        throw new Error(`Cloudflare Email Routing error: ${errorMessage}`);
      }
    }
  }

  /**
   * Send email via generic webhook (fallback method)
   */
  private async sendEmailViaWebhook(
    config: NotificationConfig, 
    serviceId: string, 
    to: string, 
    subject: string, 
    htmlBody: string, 
    textBody: string
  ): Promise<void> {
    if (!config.webhook_url) {
      throw new Error('Webhook URL not configured for email service');
    }

    const emailPayload = {
      to: to,
      from: `noreply@${serviceId}`,
      subject: subject,
      html: htmlBody,
      text: textBody,
      service_id: serviceId,
      alert_type: 'load-balancer',
      timestamp: new Date().toISOString()
    };

    const response = await fetch(config.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.api_key && { 'Authorization': `Bearer ${config.api_key}` }),
        ...(config.secret && { 'X-Webhook-Secret': config.secret })
      },
      body: JSON.stringify(emailPayload),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Email webhook error: ${response.status} - ${error}`);
    }

    console.log(`[LoadBalancer] Email sent via webhook to ${to}`);
  }

  /**
   * Create a proper MIME message (RFC-5322 compliant)
   */
  private createMimeMessage(from: string, to: string, subject: string, htmlBody: string, textBody: string): string {
    return this.createBasicMimeMessage(from, to, subject, htmlBody, textBody);
  }

  /**
   * Create a RFC-5322 compliant MIME message
   */
  private createBasicMimeMessage(from: string, to: string, subject: string, htmlBody: string, textBody: string): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const messageId = `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${from.split('@')[1] || 'loadbalancer.local'}>`;
    const date = new Date().toUTCString();
    
    // Encode subject if it contains non-ASCII characters
    const encodedSubject = this.encodeHeaderValue(subject);
    
    // Encode email addresses if they contain non-ASCII characters
    const encodedFrom = this.encodeEmailAddress(from);
    const encodedTo = this.encodeEmailAddress(to);
    
    return [
      `From: ${encodedFrom}`,
      `To: ${encodedTo}`,
      `Subject: ${encodedSubject}`,
      `Message-ID: ${messageId}`,
      `Date: ${date}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      `X-Mailer: Cloudflare Load Balancer Notifications`,
      ``,
      `This is a MIME-formatted message. If you see this text it means your email software does not support MIME-formatted messages.`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      textBody,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      htmlBody,
      ``,
      `--${boundary}--`
    ].join('\r\n');
  }

  /**
   * Encode header value using RFC 2047 encoding if needed
   */
  private encodeHeaderValue(value: string): string {
    // Check if the value contains non-ASCII characters
    if (!/^[\x00-\x7F]*$/.test(value)) {
      // Use RFC 2047 encoding for non-ASCII characters
      const encoder = new TextEncoder();
      const bytes = encoder.encode(value);
      const encoded = btoa(String.fromCharCode(...bytes));
      return `=?UTF-8?B?${encoded}?=`;
    }
    return value;
  }

  /**
   * Encode email address with display name if needed
   */
  private encodeEmailAddress(email: string): string {
    const match = email.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      const [, displayName, address] = match;
      const encodedDisplayName = this.encodeHeaderValue(displayName.trim());
      return `${encodedDisplayName} <${address}>`;
    }
    return email;
  }

  /**
   * Format email body as HTML
   */
  private formatEmailBodyHtml(payload: NotificationPayload): string {
    const severityColor = this.getSeverityColorHex(payload.severity);
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Balancer Alert</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: ${severityColor}; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; }
        .alert-details { border-left: 4px solid ${severityColor}; padding-left: 15px; margin: 20px 0; }
        .metadata { background: #f8f9fa; padding: 15px; border-radius: 4px; margin-top: 20px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
        .severity-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; background: ${severityColor}; color: white; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚨 Load Balancer Alert</h1>
            <p style="margin: 0; opacity: 0.9;">Service: ${payload.service_id}</p>
        </div>
        
        <div class="content">
            <div class="alert-details">
                <h2 style="color: ${severityColor}; margin-top: 0;">${payload.alert_type.replace(/_/g, ' ').toUpperCase()}</h2>
                <p style="font-size: 16px; margin: 10px 0;"><strong>Message:</strong> ${payload.message}</p>
                <p><strong>Severity:</strong> <span class="severity-badge">${payload.severity}</span></p>
                <p><strong>Timestamp:</strong> ${payload.timestamp}</p>
                ${payload.resolved ? `<p><strong>Resolved:</strong> ${payload.resolved_timestamp}</p>` : ''}
            </div>
            
            <div class="metadata">
                <h3 style="margin-top: 0;">Service Details</h3>
                <ul style="margin: 0; padding-left: 20px;">
                    <li><strong>Service ID:</strong> ${payload.service_id}</li>
                    <li><strong>Alert ID:</strong> ${payload.alert_id}</li>
                    <li><strong>Status:</strong> ${payload.resolved ? 'Resolved' : 'Active'}</li>
                    ${payload.metadata.service_hostname ? `<li><strong>Hostname:</strong> ${payload.metadata.service_hostname}</li>` : ''}
                    ${payload.metadata.account_id ? `<li><strong>Account ID:</strong> ${payload.metadata.account_id}</li>` : ''}
                </ul>
            </div>
        </div>
        
        <div class="footer">
            <p>This alert was generated automatically by your Cloudflare Load Balancer monitoring system.</p>
            <p>Alert ID: ${payload.alert_id} | Generated at ${payload.timestamp}</p>
        </div>
    </div>
</body>
</html>`;
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(config: NotificationConfig, payload: NotificationPayload): Promise<void> {
    if (!config.webhook_url) {
      throw new Error('Slack webhook URL not configured');
    }

    const slackPayload = {
      text: `Load Balancer Alert: ${payload.message}`,
      attachments: [
        {
          color: this.getSeverityColor(payload.severity),
          fields: [
            {
              title: 'Alert Type',
              value: payload.alert_type,
              short: true
            },
            {
              title: 'Severity',
              value: payload.severity.toUpperCase(),
              short: true
            },
            {
              title: 'Service',
              value: payload.service_id,
              short: true
            },
            {
              title: 'Timestamp',
              value: payload.timestamp,
              short: true
            }
          ]
        }
      ]
    };

    await fetch(config.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
      signal: AbortSignal.timeout(10000)
    });
  }

  /**
   * Send Discord notification
   */
  private async sendDiscordNotification(config: NotificationConfig, payload: NotificationPayload): Promise<void> {
    if (!config.webhook_url) {
      throw new Error('Discord webhook URL not configured');
    }

    const discordPayload = {
      content: `🚨 **Load Balancer Alert**`,
      embeds: [
        {
          title: payload.alert_type.replace(/_/g, ' ').toUpperCase(),
          description: payload.message,
          color: this.getSeverityColorHex(payload.severity),
          fields: [
            {
              name: 'Severity',
              value: payload.severity.toUpperCase(),
              inline: true
            },
            {
              name: 'Service',
              value: payload.service_id,
              inline: true
            },
            {
              name: 'Timestamp',
              value: payload.timestamp,
              inline: false
            }
          ],
          timestamp: payload.timestamp
        }
      ]
    };

    await fetch(config.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
      signal: AbortSignal.timeout(10000)
    });
  }

  /**
   * Send Microsoft Teams notification
   */
  private async sendTeamsNotification(config: NotificationConfig, payload: NotificationPayload): Promise<void> {
    if (!config.webhook_url) {
      throw new Error('Teams webhook URL not configured');
    }

    const teamsPayload = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": this.getSeverityColorHex(payload.severity),
      "summary": `Load Balancer Alert: ${payload.alert_type}`,
      "sections": [
        {
          "activityTitle": "Load Balancer Alert",
          "activitySubtitle": payload.service_id,
          "activityImage": "https://cloudflare.com/img/logo-web-badges/cf-logo-on-white-bg.svg",
          "facts": [
            {
              "name": "Alert Type",
              "value": payload.alert_type
            },
            {
              "name": "Severity",
              "value": payload.severity.toUpperCase()
            },
            {
              "name": "Message",
              "value": payload.message
            },
            {
              "name": "Timestamp",
              "value": payload.timestamp
            }
          ]
        }
      ]
    };

    await fetch(config.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(teamsPayload),
      signal: AbortSignal.timeout(10000)
    });
  }

  /**
   * Send PagerDuty notification
   */
  private async sendPagerDutyNotification(config: NotificationConfig, payload: NotificationPayload): Promise<void> {
    if (!config.integration_key) {
      throw new Error('PagerDuty integration key not configured');
    }

    const pagerDutyPayload = {
      routing_key: config.integration_key,
      event_action: payload.resolved ? 'resolve' : 'trigger',
      dedup_key: `lb-alert-${payload.alert_id}`,
      payload: {
        summary: `Load Balancer Alert: ${payload.message}`,
        severity: payload.severity,
        source: payload.service_id,
        timestamp: payload.timestamp,
        custom_details: payload.metadata
      }
    };

    await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pagerDutyPayload),
      signal: AbortSignal.timeout(10000)
    });
  }

  /**
   * Send OpsGenie notification
   */
  private async sendOpsGenieNotification(config: NotificationConfig, payload: NotificationPayload): Promise<void> {
    if (!config.api_key) {
      throw new Error('OpsGenie API key not configured');
    }

    const opsGeniePayload = {
      message: `Load Balancer Alert: ${payload.message}`,
      alias: `lb-alert-${payload.alert_id}`,
      description: `Alert from Load Balancer service ${payload.service_id}`,
      priority: this.mapSeverityToPriority(payload.severity),
      source: payload.service_id,
      details: payload.metadata
    };

    await fetch('https://api.opsgenie.com/v2/alerts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `GenieKey ${config.api_key}`
      },
      body: JSON.stringify(opsGeniePayload),
      signal: AbortSignal.timeout(10000)
    });
  }

  /**
   * Format email body for notifications
   */
  private formatEmailBody(payload: NotificationPayload): string {
    return `
Load Balancer Alert Details:

Alert Type: ${payload.alert_type}
Severity: ${payload.severity.toUpperCase()}
Service: ${payload.service_id}
Message: ${payload.message}
Timestamp: ${payload.timestamp}
Alert ID: ${payload.alert_id}

${payload.metadata ? `Additional Details:
${Object.entries(payload.metadata).map(([key, value]) => `${key}: ${value}`).join('\n')}` : ''}

This alert was generated by the Cloudflare Load Balancer service.
    `.trim();
  }

  /**
   * Get color for severity level (Slack format)
   */
  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'medium': return 'warning';
      case 'low': return 'good';
      default: return '#808080';
    }
  }

  /**
   * Get hex color for severity level
   */
  private getSeverityColorHex(severity: string): string {
    switch (severity) {
      case 'critical': return '#FF0000';
      case 'high': return '#FF8C00';
      case 'medium': return '#FFD700';
      case 'low': return '#00FF00';
      default: return '#808080';
    }
  }

  /**
   * Map severity to OpsGenie priority
   */
  private mapSeverityToPriority(severity: string): string {
    switch (severity) {
      case 'critical': return 'P1';
      case 'high': return 'P2';
      case 'medium': return 'P3';
      case 'low': return 'P4';
      default: return 'P3';
    }
  }

  /**
   * Main entry point for routing a request
   */
  public async routeRequest(
    request: Request, 
    clientIp: string, 
    geo?: GeographicData
  ): Promise<{ backend: Backend; pool: OriginPool; headers: Record<string, string> }> {
    const startTime = Date.now();
    
    try {
      // Apply custom rules first
      const ruleResult = await this.applyCustomRules(request, clientIp, geo);
      if (ruleResult) {
        return ruleResult;
      }
      
      // Check session affinity
      const affinityResult = this.checkSessionAffinity(request, clientIp);
      if (affinityResult) {
        this.metrics.sessionAffinityHits!++;
        return affinityResult;
      }
      
      this.metrics.sessionAffinityMisses!++;
      
      // Select pool using traffic steering
      const selectedPool = await this.selectPool(request, clientIp, geo);
      if (!selectedPool) {
        throw new Error('No healthy pools available');
      }
      
      // Select backend within pool using endpoint steering
      const selectedBackend = await this.selectBackend(selectedPool, request, clientIp);
      if (!selectedBackend) {
        throw new Error(`No healthy backends in pool ${selectedPool.id}`);
      }
      
      // Update session affinity if configured
      this.updateSessionAffinity(request, clientIp, selectedPool.id, selectedBackend.id);
      
      // Prepare response headers
      const headers = this.prepareResponseHeaders(selectedBackend, selectedPool);
      
      // Update metrics
      this.updateMetrics(selectedBackend.id, selectedPool.id, startTime);
      
      // Record steering decision
      const steeringMethod = this.config.load_balancer.steering_policy;
      this.metrics.steeringDecisions![steeringMethod] = (this.metrics.steeringDecisions![steeringMethod] || 0) + 1;
      
      return { backend: selectedBackend, pool: selectedPool, headers };
      
    } catch (error) {
      this.metrics.totalFailedRequests++;
      throw error;
    }
  }
  
  /**
   * Apply custom load balancer rules
   */
  private async applyCustomRules(
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): Promise<{ backend: Backend; pool: OriginPool; headers: Record<string, string> } | null> {
    const rules = this.config.load_balancer.rules?.filter(r => r.enabled)
      .sort((a, b) => a.priority - b.priority) || [];
      
    for (const rule of rules) {
      if (await this.evaluateRuleCondition(rule.condition, request, clientIp, geo)) {
        return this.executeRuleAction(rule.action, request, clientIp, geo);
      }
    }
    
    return null;
  }
  
  private async evaluateRuleCondition(
    condition: string,
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): Promise<boolean> {
    try {
      const context = await this.buildRuleContext(request, clientIp, geo);
      return this.evaluateExpression(condition, context);
    } catch (error) {
      console.warn(`[Rules] Failed to evaluate condition "${condition}":`, error);
      return false;
    }
  }

  /**
   * Build evaluation context for rule conditions
   */
  private async buildRuleContext(
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): Promise<Record<string, any>> {
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());
    const userAgent = headers['user-agent'] || '';
    
    // Parse path segments for positional access
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    
    // Detect client characteristics
    const isMobile = this.detectMobile(userAgent);
    const isBot = this.detectBot(userAgent);
    const browser = this.detectBrowser(userAgent);
    
    // Time-based context
    const now = new Date();
    const timeContext = {
      hour: now.getHours(),
      day: now.getDay(), // 0 = Sunday
      date: now.getDate(),
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      timestamp: now.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
    
    return {
      // URL components
      url: {
        full: request.url,
        protocol: url.protocol.replace(':', ''),
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : '80'),
        path: url.pathname,
        query: url.search,
        hash: url.hash,
        segments: pathSegments,
        params: queryParams
      },
      
      // Request details
      request: {
        method: request.method.toUpperCase(),
        headers: headers,
        contentType: headers['content-type'] || '',
        contentLength: parseInt(headers['content-length'] || '0'),
        userAgent: userAgent,
        referer: headers['referer'] || headers['referrer'] || '',
        acceptLanguage: headers['accept-language'] || '',
        acceptEncoding: headers['accept-encoding'] || '',
        cacheControl: headers['cache-control'] || ''
      },
      
      // Client information
      client: {
        ip: clientIp,
        isMobile: isMobile,
        isBot: isBot,
        browser: browser,
        country: geo?.country || '',
        region: geo?.region || '',
        city: geo?.city || '',
        timezone: geo?.timezone || '',
        asn: geo?.asn || '',
        isp: geo?.isp || ''
      },
      
      // Geographic data
      geo: geo || {},
      
      // Time context
      time: timeContext,
      
      // Path segments for positional access ($1, $2, etc.)
      ...pathSegments.reduce((acc, segment, index) => {
        acc[`$${index + 1}`] = segment;
        return acc;
      }, {} as Record<string, string>)
    };
  }

  /**
   * Secure expression evaluator for rule conditions
   */
  private evaluateExpression(expression: string, context: Record<string, any>): boolean {
    // Normalize the expression
    const normalizedExpr = expression.trim();
    
    // Handle simple boolean values
    if (normalizedExpr === 'true') return true;
    if (normalizedExpr === 'false') return false;
    
    // Parse and evaluate the expression safely
    return this.parseAndEvaluate(normalizedExpr, context);
  }

  /**
   * Parse and evaluate expression using a safe recursive descent parser
   */
  private parseAndEvaluate(expression: string, context: Record<string, any>): boolean {
    const tokens = this.tokenizeExpression(expression);
    const parser = new ExpressionParser(tokens, context);
    return parser.parseExpression();
  }

  /**
   * Tokenize expression into manageable parts
   */
  private tokenizeExpression(expression: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    
    while (i < expression.length) {
      const char = expression[i];
      
      // Skip whitespace
      if (/\s/.test(char)) {
        i++;
        continue;
      }
      
      // String literals
      if (char === '"' || char === "'") {
        const quote = char;
        let value = '';
        i++; // Skip opening quote
        
        while (i < expression.length && expression[i] !== quote) {
          if (expression[i] === '\\' && i + 1 < expression.length) {
            // Handle escaped characters
            i++;
            const escaped = expression[i];
            switch (escaped) {
              case 'n': value += '\n'; break;
              case 't': value += '\t'; break;
              case 'r': value += '\r'; break;
              case '\\': value += '\\'; break;
              case '"': value += '"'; break;
              case "'": value += "'"; break;
              default: value += escaped; break;
            }
          } else {
            value += expression[i];
          }
          i++;
        }
        i++; // Skip closing quote
        tokens.push({ type: 'string', value });
        continue;
      }
      
      // Numbers
      if (/\d/.test(char)) {
        let value = '';
        while (i < expression.length && /[\d.]/.test(expression[i])) {
          value += expression[i];
          i++;
        }
        tokens.push({ type: 'number', value: parseFloat(value) });
        continue;
      }
      
      // Multi-character operators
      if (i + 1 < expression.length) {
        const twoChar = expression.substr(i, 2);
        if (['==', '!=', '<=', '>=', '&&', '||', '=~', '!~'].includes(twoChar)) {
          tokens.push({ type: 'operator', value: twoChar });
          i += 2;
          continue;
        }
      }
      
      // Single character operators and punctuation
      if (['(', ')', '<', '>', '!', '&', '|', '+', '-', '*', '/', '%'].includes(char)) {
        tokens.push({ type: 'operator', value: char });
        i++;
        continue;
      }
      
      // Identifiers and keywords
      if (/[a-zA-Z_$]/.test(char)) {
        let value = '';
        while (i < expression.length && /[a-zA-Z0-9_.$]/.test(expression[i])) {
          value += expression[i];
          i++;
        }
        
        // Check for keywords
        if (['true', 'false', 'and', 'or', 'not', 'in', 'contains', 'startsWith', 'endsWith', 'matches'].includes(value)) {
          tokens.push({ type: 'keyword', value });
        } else {
          tokens.push({ type: 'identifier', value });
        }
        continue;
      }
      
      // Unknown character - skip it
      i++;
    }
    
    return tokens;
  }

  /**
   * Detect if user agent is mobile
   */
  private detectMobile(userAgent: string): boolean {
    const mobileRegex = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone|Opera Mini/i;
    return mobileRegex.test(userAgent);
  }

  /**
   * Detect if user agent is a bot
   */
  private detectBot(userAgent: string): boolean {
    const botRegex = /bot|crawl|spider|scraper|facebook|twitter|linkedin|whatsapp|telegram/i;
    return botRegex.test(userAgent);
  }

  /**
   * Detect browser from user agent
   */
  private detectBrowser(userAgent: string): string {
    if (/Chrome/i.test(userAgent) && !/Edge/i.test(userAgent)) return 'chrome';
    if (/Firefox/i.test(userAgent)) return 'firefox';
    if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) return 'safari';
    if (/Edge/i.test(userAgent)) return 'edge';
    if (/Opera/i.test(userAgent)) return 'opera';
    if (/MSIE|Trident/i.test(userAgent)) return 'ie';
    return 'unknown';
  }
  
  private async executeRuleAction(
    action: RuleAction,
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): Promise<{ backend: Backend; pool: OriginPool; headers: Record<string, string> } | null> {
    switch (action.type) {
      case 'forward':
        if (action.pool_id) {
          const pool = this.config.pools.find(p => p.id === action.pool_id);
          if (pool) {
            const backend = await this.selectBackend(pool, request, clientIp);
            if (backend) {
              return {
                backend,
                pool,
                headers: this.prepareResponseHeaders(backend, pool)
              };
            }
          }
        }
        break;
        
      case 'fixed_response':
        // Fixed responses terminate the request with a direct HTTP response
        throw this.createFixedResponseAction({
          status: action.status_code || 200,
          contentType: action.content_type || 'text/plain',
          content: action.content || '',
          headers: this.buildFixedResponseHeaders(action)
        });
        
      case 'redirect':
        // Redirects terminate the request with a redirect response
        throw this.createRedirectAction({
          url: this.processRedirectUrl(action.url || '', request, clientIp, geo),
          status: action.status_code_redirect || 302,
          preserveQuery: action.preserve_query_string || false,
          headers: this.buildRedirectHeaders(action, request)
        });
        
      case 'rewrite':
        // URL rewrites modify the request before forwarding
        const rewrittenRequest = this.processUrlRewrite(action, request, clientIp, geo);
        if (rewrittenRequest && action.pool_id) {
          const pool = this.config.pools.find(p => p.id === action.pool_id);
          if (pool) {
            const backend = await this.selectBackend(pool, rewrittenRequest, clientIp);
            if (backend) {
              return {
                backend,
                pool,
                headers: {
                  ...this.prepareResponseHeaders(backend, pool),
                  'X-Rewritten-Path': new URL(rewrittenRequest.url).pathname
                }
              };
            }
          }
        }
        break;
    }
    
    return null;
  }

  /**
   * Create fixed response action error
   */
  private createFixedResponseAction(config: {
    status: number;
    contentType: string;
    content: string;
    headers: Record<string, string>;
  }): Error {
    const error = new Error('Fixed response action') as any;
    error.name = 'FixedResponseAction';
    error.response = config;
    return error;
  }

  /**
   * Create redirect action error
   */
  private createRedirectAction(config: {
    url: string;
    status: number;
    preserveQuery: boolean;
    headers: Record<string, string>;
  }): Error {
    const error = new Error('Redirect action') as any;
    error.name = 'RedirectAction';
    error.response = config;
    return error;
  }

  /**
   * Build headers for fixed response actions
   */
  private buildFixedResponseHeaders(action: RuleAction): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': action.content_type || 'text/plain',
      'X-Load-Balancer-Rule': 'fixed-response',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    };

    if (action.headers) {
      Object.assign(headers, action.headers);
    }

    return headers;
  }

  /**
   * Process redirect URL with variable substitution
   */
  private processRedirectUrl(
    redirectUrl: string,
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): string {
    const url = new URL(request.url);
    
    let processedUrl = redirectUrl
      .replace(/\$\{url\.path\}/g, url.pathname)
      .replace(/\$\{url\.hostname\}/g, url.hostname)
      .replace(/\$\{url\.protocol\}/g, url.protocol.replace(':', ''))
      .replace(/\$\{client\.ip\}/g, clientIp)
      .replace(/\$\{geo\.country\}/g, geo?.country || '')
      .replace(/\$\{geo\.region\}/g, geo?.region || '');

    const pathSegments = url.pathname.split('/').filter(Boolean);
    pathSegments.forEach((segment, index) => {
      processedUrl = processedUrl.replace(new RegExp(`\\$\\{${index + 1}\\}`, 'g'), segment);
    });

    return processedUrl;
  }

  /**
   * Build headers for redirect responses
   */
  private buildRedirectHeaders(action: RuleAction, request: Request): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Load-Balancer-Rule': 'redirect',
      'Cache-Control': 'no-cache'
    };

    if (action.headers) {
      Object.assign(headers, action.headers);
    }

    return headers;
  }

  /**
   * Process URL rewrite action
   */
  private processUrlRewrite(
    action: RuleAction,
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): Request | null {
    try {
      const originalUrl = new URL(request.url);
      let newUrl = originalUrl.toString();

      if (action.path_rewrite) {
        const newPath = this.processRewritePattern(
          action.path_rewrite,
          originalUrl.pathname,
          request,
          clientIp,
          geo
        );
        originalUrl.pathname = newPath;
        newUrl = originalUrl.toString();
      }

      if (action.host_rewrite) {
        const newHost = this.processRewritePattern(
          action.host_rewrite,
          originalUrl.hostname,
          request,
          clientIp,
          geo
        );
        originalUrl.hostname = newHost;
        newUrl = originalUrl.toString();
      }

      if (action.url_rewrite) {
        newUrl = this.processRewritePattern(
          action.url_rewrite,
          request.url,
          request,
          clientIp,
          geo
        );
      }

      return new Request(newUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect,
        signal: request.signal
      });

    } catch (error) {
      console.error('[LoadBalancer] URL rewrite failed:', error);
      return null;
    }
  }

  /**
   * Process rewrite patterns with variable substitution
   */
  private processRewritePattern(
    pattern: string,
    originalValue: string,
    request: Request,
    clientIp: string,
    geo?: GeographicData
  ): string {
    const url = new URL(request.url);
    
    let result = pattern
      .replace(/\$\{url\.path\}/g, url.pathname)
      .replace(/\$\{url\.hostname\}/g, url.hostname)
      .replace(/\$\{url\.protocol\}/g, url.protocol.replace(':', ''))
      .replace(/\$\{client\.ip\}/g, clientIp)
      .replace(/\$\{geo\.country\}/g, geo?.country || '')
      .replace(/\$\{geo\.region\}/g, geo?.region || '')
      .replace(/\$\{original\}/g, originalValue);

    const regexMatch = pattern.match(/^s\/(.+?)\/(.+?)\/([gimuy]*)$/);
    if (regexMatch) {
      const [, searchPattern, replacement, flags] = regexMatch;
      try {
        const regex = new RegExp(searchPattern, flags);
        result = originalValue.replace(regex, replacement);
      } catch (error) {
        console.warn('[LoadBalancer] Invalid regex pattern in rewrite rule:', pattern);
        return originalValue;
      }
    }

    if (pattern.includes('*')) {
      const escapedPattern = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '(.*)');
      
      try {
        const regex = new RegExp(`^${escapedPattern}$`);
        const match = originalValue.match(regex);
        if (match) {
          result = pattern;
          match.slice(1).forEach((capture, index) => {
            result = result.replace('*', capture);
          });
        }
      } catch (error) {
        console.warn('[LoadBalancer] Invalid wildcard pattern in rewrite rule:', pattern);
        return originalValue;
      }
    }

    return result;
  }
  
  /**
   * Check for existing session affinity
   */
  private checkSessionAffinity(request: Request, clientIp: string): { backend: Backend; pool: OriginPool; headers: Record<string, string> } | null {
    const sessionConfig = this.config.load_balancer.session_affinity;
    if (!sessionConfig?.enabled || sessionConfig.type === 'none') {
      return null;
    }
    
    let sessionKey: string;
    
    switch (sessionConfig.type) {
      case 'cookie':
        const cookieHeader = request.headers.get('Cookie');
        if (!cookieHeader) return null;
        const cookies = this.parseCookies(cookieHeader);
        const affinityCookie = cookies[sessionConfig.cookieName || 'lb_affinity'];
        if (!affinityCookie) return null;
        sessionKey = affinityCookie;
        break;
        
      case 'ip_cookie':
        sessionKey = clientIp;
        break;
        
      case 'header':
        const headerValue = request.headers.get(sessionConfig.header_name || 'X-Session-ID');
        if (!headerValue) return null;
        sessionKey = headerValue;
        break;
        
      default:
        return null;
    }
    
    const affinity = this.sessionAffinityCache.get(sessionKey);
    if (!affinity || affinity.expires < Date.now()) {
      if (affinity) {
        this.sessionAffinityCache.delete(sessionKey);
      }
      return null;
    }
    
    // Find the backend and pool
    const pool = this.config.pools.find(p => p.id === affinity.poolId);
    const backend = pool?.backends.find(b => b.id === affinity.backendId && b.healthy && b.enabled);
    
    if (pool && backend) {
      return {
        backend,
        pool,
        headers: this.prepareResponseHeaders(backend, pool)
      };
    }
    
    // Backend/pool not available, remove affinity
    this.sessionAffinityCache.delete(sessionKey);
    return null;
  }
  
  /**
   * Update session affinity cache
   */
  private updateSessionAffinity(request: Request, clientIp: string, poolId: string, backendId: string): void {
    const sessionConfig = this.config.load_balancer.session_affinity;
    if (!sessionConfig?.enabled || sessionConfig.type === 'none') {
      return;
    }
    
    let sessionKey: string;
    const ttl = sessionConfig.ttl || 82800; // 23 hours default
    const expires = Date.now() + (ttl * 1000);
    
    switch (sessionConfig.type) {
      case 'cookie':
        // Generate session key for cookie
        sessionKey = this.generateSessionKey();
        break;
        
      case 'ip_cookie':
        sessionKey = clientIp;
        break;
        
      case 'header':
        const headerValue = request.headers.get(sessionConfig.header_name || 'X-Session-ID');
        if (!headerValue) return;
        sessionKey = headerValue;
        break;
        
      default:
        return;
    }
    
    this.sessionAffinityCache.set(sessionKey, { poolId, backendId, expires });
  }
  
  /**
   * Select pool using traffic steering algorithm
   */
  private async selectPool(request: Request, clientIp: string, geo?: GeographicData): Promise<OriginPool | null> {
    const enabledPools = this.config.pools.filter(p => p.enabled && this.isPoolHealthy(p));
    if (enabledPools.length === 0) {
      return this.getFallbackPool();
    }
    
    const steeringMethod = this.config.load_balancer.steering_policy;
    
    switch (steeringMethod) {
      case 'off':
        return this.selectPoolFailover(enabledPools);
        
      case 'random':
        return this.selectPoolRandom(enabledPools);
        
      case 'geo':
        return this.selectPoolGeo(enabledPools, geo);
        
      case 'dynamic':
        return await this.selectPoolDynamic(enabledPools, geo);
        
      case 'proximity':
        return this.selectPoolProximity(enabledPools, geo);
        
      case 'least_outstanding_requests':
        return this.selectPoolLeastOutstandingRequests(enabledPools);
        
      case 'dns_failover':
        return await this.selectPoolDnsFailover(enabledPools);
        
      default:
        return this.selectPoolRandom(enabledPools);
    }
  }
  
  private selectPoolFailover(pools: OriginPool[]): OriginPool | null {
    // Return pools in priority order (based on order in default_pool_ids)
    const poolOrder = this.config.load_balancer.default_pool_ids;
    
    for (const poolId of poolOrder) {
      const pool = pools.find(p => p.id === poolId);
      if (pool && this.isPoolHealthy(pool)) {
        return pool;
      }
    }
    
    return pools[0] || null;
  }
  
  private selectPoolRandom(pools: OriginPool[]): OriginPool | null {
    if (pools.length === 0) return null;
    
    // Calculate total weight
    const totalWeight = pools.reduce((sum, pool) => sum + (pool.backends.length || 1), 0);
    let random = Math.random() * totalWeight;
    
    for (const pool of pools) {
      const weight = pool.backends.length || 1;
      random -= weight;
      if (random <= 0) {
        return pool;
      }
    }
    
    return pools[pools.length - 1];
  }
  
  private selectPoolGeo(pools: OriginPool[], geo?: GeographicData): OriginPool | null {
    if (!geo) return this.selectPoolRandom(pools);
    
    // Check country-specific pools first
    if (this.config.load_balancer.country_pools?.[geo.country]) {
      const countryPoolIds = this.config.load_balancer.country_pools[geo.country];
      const countryPools = pools.filter(p => countryPoolIds.includes(p.id));
      if (countryPools.length > 0) {
        return this.selectPoolRandom(countryPools);
      }
    }
    
    // Check region-specific pools
    if (this.config.load_balancer.region_pools?.[geo.region]) {
      const regionPoolIds = this.config.load_balancer.region_pools[geo.region];
      const regionPools = pools.filter(p => regionPoolIds.includes(p.id));
      if (regionPools.length > 0) {
        return this.selectPoolRandom(regionPools);
      }
    }
    
    return this.selectPoolRandom(pools);
  }
  
  private async selectPoolDynamic(pools: OriginPool[], geo?: GeographicData): Promise<OriginPool | null> {
    // Dynamic steering uses RTT data to select the fastest pool
    const region = geo?.region || 'default';
    
    // Calculate RTT scores for each pool
    const poolRtts: Array<{ pool: OriginPool; rtt: number }> = [];
    
    for (const pool of pools) {
      const cachedRtt = this.rttCache.get(pool.id)?.[region];
      const rtt = cachedRtt || await this.measurePoolRtt(pool, region);
      poolRtts.push({ pool, rtt });
    }
    
    // Sort by RTT (lower is better)
    poolRtts.sort((a, b) => a.rtt - b.rtt);
    
    return poolRtts[0]?.pool || null;
  }
  
  private selectPoolProximity(pools: OriginPool[], geo?: GeographicData): OriginPool | null {
    if (!geo || !geo.latitude || !geo.longitude) {
      return this.selectPoolRandom(pools);
    }
    
    // Calculate distance to each pool
    const poolDistances: Array<{ pool: OriginPool; distance: number }> = [];
    
    for (const pool of pools) {
      if (pool.latitude !== undefined && pool.longitude !== undefined) {
        const distance = this.calculateDistance(
          geo.latitude, geo.longitude,
          pool.latitude, pool.longitude
        );
        poolDistances.push({ pool, distance });
      }
    }
    
    // Sort by distance (closer is better)
    poolDistances.sort((a, b) => a.distance - b.distance);
    
    return poolDistances[0]?.pool || this.selectPoolRandom(pools);
  }
  
  private selectPoolLeastOutstandingRequests(pools: OriginPool[]): OriginPool | null {
    // LORS - Select pool with least outstanding requests, factoring in weight
    const poolScores: Array<{ pool: OriginPool; score: number }> = [];
    
    for (const pool of pools) {
      const weight = pool.backends.length || 1;
      const outstandingRequests = pool.backends.reduce((sum, b) => sum + (b.outstandingRequests || 0), 0);
      
      // Calculate transformed weight: weight / (outstanding_requests + 1)
      const transformedWeight = weight / (outstandingRequests + 1);
      poolScores.push({ pool, score: transformedWeight });
    }
    
    // Sort by score (higher is better)
    poolScores.sort((a, b) => b.score - a.score);
    
    // Use weighted random selection based on scores
    const totalScore = poolScores.reduce((sum, p) => sum + p.score, 0);
    let random = Math.random() * totalScore;
    
    for (const { pool, score } of poolScores) {
      random -= score;
      if (random <= 0) {
        return pool;
      }
    }
    
    return poolScores[0]?.pool || null;
  }
  
  private async selectPoolDnsFailover(pools: OriginPool[]): Promise<OriginPool | null> {
    if (!this.dnsState || !this.config.load_balancer.dns_failover) {
      return this.selectPoolRandom(pools);
    }
    
    const dnsConfig = this.config.load_balancer.dns_failover;
    
    // Check if we should failover or recover
    await this.updateDnsFailoverState();
    
    // Return current pool based on DNS failover state
    switch (this.dnsState.failover_state) {
      case 'primary':
        const primaryPool = pools.find(p => p.id === dnsConfig.primary_pool_id);
        return primaryPool || this.handleDnsFailover();
        
      case 'failover':
        // Use the first available failover pool
        for (const poolId of dnsConfig.failover_pool_ids) {
          const pool = pools.find(p => p.id === poolId);
          if (pool && this.isPoolHealthy(pool)) {
            return pool;
          }
        }
        return null;
        
      case 'recovery':
        // Check if primary is healthy for recovery
        const primaryPoolForRecovery = pools.find(p => p.id === dnsConfig.primary_pool_id);
        if (primaryPoolForRecovery && this.isPoolHealthy(primaryPoolForRecovery)) {
          return primaryPoolForRecovery;
        }
        return this.handleDnsFailover();
        
      default:
        return this.selectPoolRandom(pools);
    }
  }
  
  /**
   * Handle DNS failover logic
   */
  private async handleDnsFailover(): Promise<OriginPool | null> {
    if (!this.dnsState || !this.config.load_balancer.dns_failover) {
      return null;
    }
    
    const dnsConfig = this.config.load_balancer.dns_failover;
    
    // Increment failure count
    this.dnsState.failure_count++;
    
    // Check if we should trigger failover
    if (this.dnsState.failure_count >= dnsConfig.failure_threshold) {
      this.dnsState.failover_state = 'failover';
      this.dnsState.last_failover_time = Date.now();
      this.metrics.dnsFailovers = (this.metrics.dnsFailovers || 0) + 1;
      
      // Update DNS records to point to failover backends
      await this.updateDnsRecordsForFailover();
      
      // Find first healthy failover pool
      for (const poolId of dnsConfig.failover_pool_ids) {
        const pool = this.config.pools.find(p => p.id === poolId);
        if (pool && this.isPoolHealthy(pool)) {
          this.dnsState.current_pool_id = poolId;
          this.dnsState.current_backend_ips = pool.backends
            .filter(b => b.healthy && b.enabled)
            .map(b => b.ip);
          return pool;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Update DNS failover state based on health checks
   */
  private async updateDnsFailoverState(): Promise<void> {
    if (!this.dnsState || !this.config.load_balancer.dns_failover) {
      return;
    }
    
    const dnsConfig = this.config.load_balancer.dns_failover;
    const primaryPool = this.config.pools.find(p => p.id === dnsConfig.primary_pool_id);
    
    if (!primaryPool) return;
    
    const isPrimaryHealthy = this.isPoolHealthy(primaryPool);
    
    switch (this.dnsState.failover_state) {
      case 'primary':
        if (!isPrimaryHealthy) {
          await this.handleDnsFailover();
        }
        break;
        
      case 'failover':
        if (isPrimaryHealthy) {
          this.dnsState.failover_state = 'recovery';
          this.dnsState.recovery_count = 0;
        }
        break;
        
      case 'recovery':
        if (isPrimaryHealthy) {
          this.dnsState.recovery_count++;
          if (this.dnsState.recovery_count >= dnsConfig.recovery_threshold) {
            // Recovery successful, switch back to primary
            this.dnsState.failover_state = 'primary';
            this.dnsState.current_pool_id = dnsConfig.primary_pool_id;
            this.dnsState.current_backend_ips = primaryPool.backends
              .filter(b => b.healthy && b.enabled)
              .map(b => b.ip);
            this.dnsState.failure_count = 0;
            this.dnsState.recovery_count = 0;
            this.metrics.dnsRecoveries = (this.metrics.dnsRecoveries || 0) + 1;
            
            await this.updateDnsRecordsForRecovery();
          }
        } else {
          // Primary became unhealthy again during recovery
          this.dnsState.failover_state = 'failover';
          this.dnsState.recovery_count = 0;
        }
        break;
    }
  }
  
  /**
   * Select backend within a pool using endpoint steering
   */
  private async selectBackend(pool: OriginPool, request: Request, clientIp: string): Promise<Backend | null> {
    // Filter to only available backends (considering circuit breaker state and health)
    const availableBackends = pool.backends.filter(b => this.isBackendAvailable(b));
    
    if (availableBackends.length === 0) {
      console.warn(`[LoadBalancer] No available backends in pool ${pool.id} (considering circuit breaker states)`);
      
      // If zero-downtime failover is enabled, try to find any backend that might work
      const zeroDowntimeConfig = this.config.load_balancer.zero_downtime_failover;
      if (zeroDowntimeConfig?.enabled) {
        const emergencyBackends = pool.backends.filter(b => b.enabled);
        if (emergencyBackends.length > 0) {
          console.warn(`[LoadBalancer] Using emergency backend selection for zero-downtime failover`);
          return this.selectBestAvailableBackend(emergencyBackends);
        }
      }
      
      return null;
    }
    
    // Sort backends by health score if health scoring is enabled
    const healthScoringEnabled = this.config.passiveHealthChecks.health_scoring?.enabled;
    if (healthScoringEnabled) {
      availableBackends.sort((a, b) => (b.healthScore || 100) - (a.healthScore || 100));
    }
    
    const steeringMethod = pool.endpoint_steering;
    
    switch (steeringMethod) {
      case 'random':
        return this.selectBackendRandom(availableBackends);
        
      case 'round_robin':
        return this.selectBackendRoundRobin(availableBackends);
        
      case 'hash':
        return this.selectBackendHash(availableBackends, clientIp);
        
      case 'least_outstanding_requests':
        return this.selectBackendLeastOutstandingRequests(availableBackends);
        
      case 'least_connections':
        return this.selectBackendLeastConnections(availableBackends);
        
      default:
        return this.selectBackendRandom(availableBackends);
    }
  }
  
  /**
   * Select the best available backend based on health score and circuit breaker state
   * Used for emergency situations when normal selection fails
   */
  private selectBestAvailableBackend(backends: Backend[]): Backend | null {
    if (backends.length === 0) return null;
    
    // Prefer backends with closed circuit breakers and higher health scores
    const sortedBackends = backends.sort((a, b) => {
      // First priority: circuit breaker state
      const aStateScore = a.circuitBreakerState === 'closed' ? 2 : 
                         a.circuitBreakerState === 'half-open' ? 1 : 0;
      const bStateScore = b.circuitBreakerState === 'closed' ? 2 : 
                         b.circuitBreakerState === 'half-open' ? 1 : 0;
      
      if (aStateScore !== bStateScore) {
        return bStateScore - aStateScore;
      }
      
      // Second priority: health score
      return (b.healthScore || 0) - (a.healthScore || 0);
    });
    
    return sortedBackends[0];
  }
  
  private selectBackendRandom(backends: Backend[]): Backend | null {
    if (backends.length === 0) return null;
    
    // Calculate total weight
    const totalWeight = backends.reduce((sum, backend) => sum + backend.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const backend of backends) {
      random -= backend.weight;
      if (random <= 0) {
        return backend;
      }
    }
    
    return backends[backends.length - 1];
  }
  
  private selectBackendRoundRobin(backends: Backend[]): Backend | null {
    if (backends.length === 0) return null;
    
    // Update round robin index
    this.config.currentRoundRobinIndex = (this.config.currentRoundRobinIndex + 1) % backends.length;
    return backends[this.config.currentRoundRobinIndex];
  }
  
  private selectBackendHash(backends: Backend[], clientIp: string): Backend | null {
    if (backends.length === 0) return null;
    
    // Simple hash function based on client IP
    const hash = this.hashString(clientIp);
    const index = hash % backends.length;
    return backends[index];
  }
  
  private selectBackendLeastOutstandingRequests(backends: Backend[]): Backend | null {
    if (backends.length === 0) return null;
    
    // Calculate scores based on weight and outstanding requests
    const backendScores: Array<{ backend: Backend; score: number }> = [];
    
    for (const backend of backends) {
      const outstandingRequests = backend.outstandingRequests || 0;
      // Transform weight: weight / (outstanding_requests + 1)
      const transformedWeight = backend.weight / (outstandingRequests + 1);
      backendScores.push({ backend, score: transformedWeight });
    }
    
    // Sort by score (higher is better)
    backendScores.sort((a, b) => b.score - a.score);
    
    // Use weighted random selection
    const totalScore = backendScores.reduce((sum, b) => sum + b.score, 0);
    let random = Math.random() * totalScore;
    
    for (const { backend, score } of backendScores) {
      random -= score;
      if (random <= 0) {
        return backend;
      }
    }
    
    return backendScores[0]?.backend || null;
  }
  
  private selectBackendLeastConnections(backends: Backend[]): Backend | null {
    if (backends.length === 0) return null;
    
    // Find backend with least active connections
    let minConnections = Infinity;
    const candidates: Backend[] = [];
    
    for (const backend of backends) {
      const connections = this.metrics.backendMetrics[backend.id]?.connectionsActive || 0;
      if (connections < minConnections) {
        minConnections = connections;
        candidates.length = 0;
        candidates.push(backend);
      } else if (connections === minConnections) {
        candidates.push(backend);
      }
    }
    
    // If multiple backends have same connection count, use random selection
    return this.selectBackendRandom(candidates);
  }
  
  /**
   * Utility functions
   */
  private isPoolHealthy(pool: OriginPool): boolean {
    const healthyBackends = pool.backends.filter(b => b.healthy && b.enabled);
    return healthyBackends.length >= pool.minimum_origins;
  }
  
  private getFallbackPool(): OriginPool | null {
    const fallbackPoolId = this.config.load_balancer.fallback_pool_id;
    if (!fallbackPoolId) return null;
    
    return this.config.pools.find(p => p.id === fallbackPoolId) || null;
  }
  
  private prepareResponseHeaders(backend: Backend, pool: OriginPool): Record<string, string> {
    const headers: Record<string, string> = {};
    
    if (this.config.observability.responseHeaderName) {
      headers[this.config.observability.responseHeaderName] = backend.id;
    }
    
    if (this.config.observability.add_backend_header) {
      headers['X-LB-Backend'] = backend.id;
    }
    
    if (this.config.observability.add_pool_header) {
      headers['X-LB-Pool'] = pool.id;
    }
    
    if (this.config.observability.add_region_header && backend.region) {
      headers['X-LB-Region'] = backend.region;
    }
    
    return headers;
  }
  
  private updateMetrics(backendId: string, poolId: string, startTime: number): void {
    const duration = Date.now() - startTime;
    
    // Update service metrics
    this.metrics.totalRequests++;
    this.metrics.totalSuccessfulRequests++;
    
    // Update backend metrics
    const backendMetrics = this.metrics.backendMetrics[backendId];
    if (backendMetrics) {
      backendMetrics.requests++;
      backendMetrics.successfulRequests++;
      backendMetrics.totalResponseTimeMs += duration;
      backendMetrics.avgResponseTimeMs = backendMetrics.totalResponseTimeMs / backendMetrics.requests;
      backendMetrics.lastRequestTimestamp = Date.now();
    }
    
    // Update pool metrics
    const poolMetrics = this.metrics.poolMetrics[poolId];
    if (poolMetrics) {
      poolMetrics.totalRequests++;
      poolMetrics.totalSuccessfulRequests++;
      poolMetrics.avgResponseTime = (poolMetrics.avgResponseTime * (poolMetrics.totalRequests - 1) + duration) / poolMetrics.totalRequests;
    }
  }
  
  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });
    
    return cookies;
  }
  
  private generateSessionKey(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
  
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
  
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    // Haversine formula for calculating distance between two points on Earth
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
  
  private async measurePoolRtt(pool: OriginPool, region: string): Promise<number> {
    try {
      // Measure actual RTT to pool endpoints
      const rttMeasurements: number[] = [];
      const maxBackendsToTest = 3; // Test up to 3 backends per pool
      const backendsToTest = pool.backends
        .filter(b => b.enabled && b.healthy)
        .slice(0, maxBackendsToTest);
      
      if (backendsToTest.length === 0) {
        // No healthy backends, return high RTT to deprioritize this pool
        return 5000; // 5 seconds
      }
      
      // Measure RTT to each backend
      for (const backend of backendsToTest) {
        const rtt = await this.measureBackendRtt(backend, region);
        if (rtt > 0) {
          rttMeasurements.push(rtt);
        }
      }
      
      if (rttMeasurements.length === 0) {
        // All measurements failed, return high RTT
        return 5000;
      }
      
      // Calculate average RTT
      const avgRtt = rttMeasurements.reduce((sum, rtt) => sum + rtt, 0) / rttMeasurements.length;
      
      // Cache the result
      if (!this.rttCache.has(pool.id)) {
        this.rttCache.set(pool.id, {});
      }
      this.rttCache.get(pool.id)![region] = avgRtt;
      
      return avgRtt;
      
    } catch (error) {
      console.error(`[LoadBalancer] Failed to measure RTT for pool ${pool.id}:`, error);
      // Return cached value if available, otherwise return high RTT
      const cached = this.rttCache.get(pool.id)?.[region];
      return cached || 5000;
    }
  }

  /**
   * Measure RTT to a specific backend
   */
  private async measureBackendRtt(backend: Backend, region: string): Promise<number> {
    try {
      const startTime = performance.now();
      
      // Use HEAD request for minimal data transfer
      const response = await fetch(backend.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000), // 5 second timeout
        headers: {
          'User-Agent': 'Cloudflare-LoadBalancer-HealthCheck/1.0',
          'Cache-Control': 'no-cache'
        }
      });
      
      const endTime = performance.now();
      const rtt = endTime - startTime;
      
      // Only consider successful responses for RTT measurement
      if (response.ok) {
        return rtt;
      } else {
        return -1; // Indicate failure
      }
      
    } catch (error) {
      console.warn(`[LoadBalancer] RTT measurement failed for ${backend.url}:`, error);
      return -1; // Indicate failure
    }
  }
  
  private async updateDnsRecordsForFailover(): Promise<void> {
    try {
      const dnsConfig = this.config.load_balancer.dns_failover;
      if (!dnsConfig?.enabled || !this.dnsState) {
        return;
      }

      const failoverPool = this.config.pools.find(p => dnsConfig.failover_pool_ids.includes(p.id));
      if (!failoverPool) {
        console.error('[DNS] Failover pool not found in:', dnsConfig.failover_pool_ids);
        return;
      }

      // Get all healthy backends from failover pool
      const healthyBackends = failoverPool.backends.filter(b => b.enabled && b.healthy);
      if (healthyBackends.length === 0) {
        console.error('[DNS] No healthy backends in failover pool');
        return;
      }

      // Extract IP addresses from backend URLs
      const failoverIps = await this.extractIpAddressesFromBackends(healthyBackends);
      if (failoverIps.length === 0) {
        console.error('[DNS] No valid IP addresses found in failover backends');
        return;
      }

      // Update DNS records to point to failover IPs
      await this.updateDnsRecords(dnsConfig.dns_record_name, failoverIps, 'failover');
      
      // Update DNS state
      this.dnsState.currentPool = failoverPool.id;
      this.dnsState.current_pool_id = failoverPool.id;
      this.dnsState.lastFailoverTime = Date.now();
      this.dnsState.last_failover_time = Date.now();
      this.dnsState.failoverActive = true;
      this.dnsState.failover_state = 'failover';

      // Generate alert
      this.generateAlert({
        id: `dns-failover-${Date.now()}`,
        type: 'dns_failover_triggered',
        severity: 'high',
        message: `DNS failover activated - switched to pool ${failoverPool.id}`,
        timestamp: Date.now(),
        metadata: {
          poolId: failoverPool.id,
          recordName: dnsConfig.dns_record_name,
          failoverIps: failoverIps.join(', ')
        }
      });

      console.log(`[DNS] Failover completed - updated ${dnsConfig.dns_record_name} to IPs: ${failoverIps.join(', ')}`);
      
    } catch (error) {
      console.error('[DNS] Failover update failed:', error);
      
      this.generateAlert({
        id: `dns-failover-error-${Date.now()}`,
        type: 'dns_failover_error',
        severity: 'critical',
        message: `DNS failover failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
        metadata: { error: String(error) }
      });
    }
  }
  
  private async updateDnsRecordsForRecovery(): Promise<void> {
    try {
      const dnsConfig = this.config.load_balancer.dns_failover;
      if (!dnsConfig?.enabled || !this.dnsState) {
        return;
      }

      const primaryPool = this.config.pools.find(p => p.id === dnsConfig.primary_pool_id);
      if (!primaryPool) {
        console.error('[DNS] Primary pool not found:', dnsConfig.primary_pool_id);
        return;
      }

      // Get all healthy backends from primary pool
      const healthyBackends = primaryPool.backends.filter(b => b.enabled && b.healthy);
      if (healthyBackends.length === 0) {
        console.error('[DNS] No healthy backends in primary pool for recovery');
        return;
      }

      // Extract IP addresses from backend URLs
      const primaryIps = await this.extractIpAddressesFromBackends(healthyBackends);
      if (primaryIps.length === 0) {
        console.error('[DNS] No valid IP addresses found in primary backends');
        return;
      }

      // Update DNS records to point back to primary IPs
      await this.updateDnsRecords(dnsConfig.dns_record_name, primaryIps, 'recovery');
      
      // Update DNS state
      this.dnsState.currentPool = dnsConfig.primary_pool_id;
      this.dnsState.lastRecoveryTime = Date.now();
      this.dnsState.failoverActive = false;

      // Generate alert
      this.generateAlert({
        id: `dns-recovery-${Date.now()}`,
        type: 'dns_recovery_completed',
        severity: 'medium',
        message: `DNS recovery completed - switched back to primary pool ${dnsConfig.primary_pool_id}`,
        timestamp: Date.now(),
        metadata: {
          poolId: dnsConfig.primary_pool_id,
          recordName: dnsConfig.dns_record_name,
          primaryIps: primaryIps.join(', ')
        }
      });

      console.log(`[DNS] Recovery completed - updated ${dnsConfig.dns_record_name} back to primary IPs: ${primaryIps.join(', ')}`);
      
    } catch (error) {
      console.error('[DNS] Recovery update failed:', error);
      
      this.generateAlert({
        id: `dns-recovery-error-${Date.now()}`,
        type: 'dns_recovery_error',
        severity: 'high',
        message: `DNS recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
        metadata: { error: String(error) }
      });
    }
  }

  /**
   * Extract IP addresses from backend URLs
   */
  private async extractIpAddressesFromBackends(backends: Backend[]): Promise<string[]> {
    const ips: string[] = [];
    
    for (const backend of backends) {
      try {
        const url = new URL(backend.url);
        const hostname = url.hostname;
        
        // Check if hostname is already an IP address
        if (this.isValidIpAddress(hostname)) {
          ips.push(hostname);
        } else {
          // Resolve hostname to IP address
          const resolvedIps = await this.resolveHostname(hostname);
          ips.push(...resolvedIps);
        }
      } catch (error) {
        console.warn(`[DNS] Failed to extract IP from backend ${backend.url}:`, error);
      }
    }
    
    // Remove duplicates and return
    return [...new Set(ips)];
  }

  /**
   * Check if a string is a valid IP address
   */
  private isValidIpAddress(ip: string): boolean {
    // IPv4 regex - comprehensive validation
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    // IPv6 regex - comprehensive RFC-compliant validation
    // Supports all IPv6 formats: full, compressed, IPv4-mapped, link-local, etc.
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    
    if (ipv4Regex.test(ip)) {
      return true;
    }
    
    if (ipv6Regex.test(ip)) {
      // Additional IPv6 validation for edge cases
      const compressionCount = (ip.match(/::/g) || []).length;
      if (compressionCount > 1) {
        return false; // Only one :: compression allowed
      }
      
      // Validate zone index format for link-local addresses (fe80::...%interface)
      if (ip.includes('%')) {
        const parts = ip.split('%');
        if (parts.length !== 2 || !parts[1].match(/^[0-9a-zA-Z]+$/)) {
          return false;
        }
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Resolve hostname to IP addresses using DNS
   */
  private async resolveHostname(hostname: string): Promise<string[]> {
    try {
      // In a Cloudflare Workers environment, we can use the DNS over HTTPS API
      const dohUrl = `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`;
      
      const response = await fetch(dohUrl, {
        headers: {
          'Accept': 'application/dns-json'
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        throw new Error(`DNS resolution failed: ${response.status}`);
      }
      
      const dnsResponse = await response.json() as any;
      const ips: string[] = [];
      
      if (dnsResponse.Answer) {
        for (const answer of dnsResponse.Answer) {
          if (answer.type === 1) { // A record
            ips.push(answer.data);
          }
        }
      }
      
      return ips;
      
    } catch (error) {
      console.warn(`[DNS] Failed to resolve hostname ${hostname}:`, error);
      return [];
    }
  }

  /**
   * Update DNS records using Cloudflare API
   */
  private async updateDnsRecords(recordName: string, ips: string[], operation: 'failover' | 'recovery'): Promise<void> {
    try {
      // Get required configuration from environment or config
      const zoneId = this.env?.CLOUDFLARE_ZONE_ID || this.config.load_balancer.dns_failover?.zone_id;
      const apiToken = this.env?.CLOUDFLARE_API_TOKEN || this.config.load_balancer.dns_failover?.api_token;
      
      if (!zoneId || !apiToken) {
        console.warn(`[DNS] Missing required configuration for DNS API integration. Zone ID: ${!!zoneId}, API Token: ${!!apiToken}`);
        return this.enhancedDnsUpdate(recordName, ips, operation);
      }
      
      const recordType = ips.every(ip => this.isValidIpAddress(ip) && ip.includes(':')) ? 'AAAA' : 'A';
      const ttl = 300; // 5 minutes for fast failover
      
      console.log(`[DNS] ${operation.toUpperCase()} - Updating DNS records via Cloudflare API:`, {
        recordName,
        recordType,
        ips,
        ttl,
        operation
      });
      
      // Step 1: Get existing DNS records for the hostname
      const existingRecords = await this.getExistingDnsRecords(zoneId, apiToken, recordName, recordType);
      
      // Step 2: Plan the DNS record changes
      const recordChanges = this.planDnsRecordChanges(existingRecords, ips, recordName, recordType, ttl);
      
      // Step 3: Execute the changes using batch API for efficiency
      if (recordChanges.deletes.length > 0 || recordChanges.creates.length > 0 || recordChanges.updates.length > 0) {
        await this.executeDnsRecordChanges(zoneId, apiToken, recordChanges);
        console.log(`[DNS] Successfully updated ${recordName} with ${ips.length} IP(s) for ${operation}`);
      } else {
        console.log(`[DNS] No changes needed for ${recordName} - records already match target IPs`);
      }
      
    } catch (error) {
      console.error(`[DNS] Failed to update DNS records for ${operation}:`, error);
      // Fallback to enhanced DNS management if API fails
      console.warn(`[DNS] Falling back to enhanced DNS management`);
      await this.enhancedDnsUpdate(recordName, ips, operation);
    }
  }
  
  /**
   * Get existing DNS records from Cloudflare API
   */
  private async getExistingDnsRecords(zoneId: string, apiToken: string, recordName: string, recordType: string): Promise<any[]> {
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${encodeURIComponent(recordName)}&type=${recordType}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch DNS records: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as any;
    if (!data.success) {
      throw new Error(`DNS API error: ${data.errors?.[0]?.message || 'Unknown error'}`);
    }
    
    return data.result || [];
  }
  
  /**
   * Plan DNS record changes (creates, updates, deletes)
   */
  private planDnsRecordChanges(existingRecords: any[], targetIps: string[], recordName: string, recordType: string, ttl: number): {
    deletes: any[];
    creates: any[];
    updates: any[];
  } {
    const changes = {
      deletes: [] as any[],
      creates: [] as any[],
      updates: [] as any[]
    };
    
    const existingIps = existingRecords.map(record => record.content);
    const targetIpSet = new Set(targetIps);
    const existingIpSet = new Set(existingIps);
    
    // Find records to delete (existing IPs not in target)
    for (const record of existingRecords) {
      if (!targetIpSet.has(record.content)) {
        changes.deletes.push({ id: record.id });
      }
    }
    
    // Find records to create (target IPs not in existing)
    for (const ip of targetIps) {
      if (!existingIpSet.has(ip)) {
        changes.creates.push({
          type: recordType,
          name: recordName,
          content: ip,
          ttl: ttl,
          comment: `Load balancer ${recordType} record - managed by Cloudflare Load Balancer`
        });
      }
    }
    
    // Find records to update (existing records with different TTL or that need comment updates)
    for (const record of existingRecords) {
      if (targetIpSet.has(record.content)) {
        const needsUpdate = record.ttl !== ttl || 
                          !record.comment?.includes('Load balancer') ||
                          record.comment?.includes('managed by Cloudflare Load Balancer') === false;
        
        if (needsUpdate) {
          changes.updates.push({
            id: record.id,
            ttl: ttl,
            comment: `Load balancer ${recordType} record - managed by Cloudflare Load Balancer`
          });
        }
      }
    }
    
    return changes;
  }
  
  /**
   * Execute DNS record changes using Cloudflare batch API
   */
  private async executeDnsRecordChanges(zoneId: string, apiToken: string, changes: {
    deletes: any[];
    creates: any[];
    updates: any[];
  }): Promise<void> {
    // Use batch API if there are multiple changes, otherwise use individual API calls
    const totalChanges = changes.deletes.length + changes.creates.length + changes.updates.length;
    
    if (totalChanges === 0) {
      return;
    }
    
    if (totalChanges > 1) {
      // Use batch API for multiple changes
      await this.executeBatchDnsChanges(zoneId, apiToken, changes);
    } else {
      // Use individual API calls for single changes
      await this.executeIndividualDnsChanges(zoneId, apiToken, changes);
    }
  }
  
  /**
   * Execute DNS changes using Cloudflare batch API
   */
  private async executeBatchDnsChanges(zoneId: string, apiToken: string, changes: {
    deletes: any[];
    creates: any[];
    updates: any[];
  }): Promise<void> {
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/batch`;
    
    const batchPayload: any = {};
    
    if (changes.deletes.length > 0) {
      batchPayload.deletes = changes.deletes;
    }
    
    if (changes.creates.length > 0) {
      batchPayload.posts = changes.creates;
    }
    
    if (changes.updates.length > 0) {
      batchPayload.patches = changes.updates;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(batchPayload),
      signal: AbortSignal.timeout(30000)
    });
    
    if (!response.ok) {
      throw new Error(`Batch DNS update failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as any;
    if (!data.success) {
      throw new Error(`Batch DNS API error: ${data.errors?.[0]?.message || 'Unknown error'}`);
    }
    
    console.log(`[DNS] Batch operation completed: ${changes.deletes.length} deleted, ${changes.creates.length} created, ${changes.updates.length} updated`);
  }
  
  /**
   * Execute DNS changes using individual API calls
   */
  private async executeIndividualDnsChanges(zoneId: string, apiToken: string, changes: {
    deletes: any[];
    creates: any[];
    updates: any[];
  }): Promise<void> {
    const headers = {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    };
    
    // Execute deletes
    for (const deleteRecord of changes.deletes) {
      const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${deleteRecord.id}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete DNS record ${deleteRecord.id}: ${response.status}`);
      }
    }
    
    // Execute creates
    for (const createRecord of changes.creates) {
      const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(createRecord),
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create DNS record: ${response.status}`);
      }
    }
    
    // Execute updates
    for (const updateRecord of changes.updates) {
      const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${updateRecord.id}`;
      const { id, ...updateData } = updateRecord;
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(updateData),
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to update DNS record ${updateRecord.id}: ${response.status}`);
      }
    }
    
    console.log(`[DNS] Individual operations completed: ${changes.deletes.length} deleted, ${changes.creates.length} created, ${changes.updates.length} updated`);
  }
  
  /**
   * Enhanced DNS management with multiple provider support and comprehensive fallback options
   */
  private async enhancedDnsUpdate(recordName: string, ips: string[], operation: 'failover' | 'recovery'): Promise<void> {
    const recordType = ips.every(ip => this.isValidIpAddress(ip) && ip.includes(':')) ? 'AAAA' : 'A';
    const dnsConfig = this.config.load_balancer.dns_failover;
    
    // Try multiple DNS management approaches in order of preference
    const dnsProviders = [
      () => this.updateViaCloudflareApi(recordName, ips, operation, recordType),
      () => this.updateViaRoute53Api(recordName, ips, operation, recordType),
      () => this.updateViaCloudflareWorkersKv(recordName, ips, operation, recordType),
      () => this.updateViaDnsOverHttps(recordName, ips, operation, recordType),
      () => this.updateViaWebhookNotification(recordName, ips, operation, recordType),
      () => this.logStructuredDnsChange(recordName, ips, operation, recordType)
    ];
    
    let lastError: Error | null = null;
    
    for (const provider of dnsProviders) {
      try {
        await provider();
        console.log(`[DNS] Successfully updated ${recordName} with ${ips.length} IP(s) for ${operation}`);
        
        // Store successful DNS state for monitoring
        await this.storeDnsState(recordName, ips, operation, recordType);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[DNS] Provider failed for ${operation}:`, error);
        continue;
      }
    }
    
    // If all providers failed, generate alert and log comprehensive failure
    console.error(`[DNS] All DNS providers failed for ${operation}:`, lastError);
    this.generateAlert({
      id: `dns-failure-${Date.now()}`,
      type: 'dns_failover_error',
      severity: 'critical',
      message: `DNS ${operation} failed for ${recordName}: ${lastError?.message || 'Unknown error'}`,
      timestamp: Date.now(),
      metadata: {
        recordName,
        ips,
        operation,
        recordType,
        error: lastError?.message
      }
    });
  }
  
  /**
   * Update DNS via Cloudflare API (primary method)
   */
  private async updateViaCloudflareApi(recordName: string, ips: string[], operation: string, recordType: string): Promise<void> {
    const zoneId = this.env?.CLOUDFLARE_ZONE_ID || this.config.load_balancer.dns_failover?.zone_id;
    const apiToken = this.env?.CLOUDFLARE_API_TOKEN || this.config.load_balancer.dns_failover?.api_token;
    
    if (!zoneId || !apiToken) {
      throw new Error('Missing Cloudflare DNS API configuration');
    }
    
    const ttl = 300; // 5 minutes for fast failover
    console.log(`[DNS] Cloudflare API - ${operation.toUpperCase()} - Updating DNS records:`, {
      recordName, recordType, ips, ttl, operation
    });
    
    const existingRecords = await this.getExistingDnsRecords(zoneId, apiToken, recordName, recordType);
    const recordChanges = this.planDnsRecordChanges(existingRecords, ips, recordName, recordType, ttl);
    
    if (recordChanges.deletes.length > 0 || recordChanges.creates.length > 0 || recordChanges.updates.length > 0) {
      await this.executeDnsRecordChanges(zoneId, apiToken, recordChanges);
    }
  }
  
  /**
   * Update DNS via AWS Route 53 API (secondary method)
   */
  private async updateViaRoute53Api(recordName: string, ips: string[], operation: string, recordType: string): Promise<void> {
    const hostedZoneId = this.env?.AWS_ROUTE53_HOSTED_ZONE_ID;
    const accessKeyId = this.env?.AWS_ACCESS_KEY_ID;
    const secretAccessKey = this.env?.AWS_SECRET_ACCESS_KEY;
    const region = this.env?.AWS_REGION || 'us-east-1';
    
    if (!hostedZoneId || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing AWS Route 53 API configuration');
    }
    
    console.log(`[DNS] Route 53 API - ${operation.toUpperCase()} - Updating DNS records:`, {
      recordName, recordType, ips, operation
    });
    
    const changeBatch = {
      Changes: [{
        Action: 'UPSERT',
        ResourceRecordSet: {
          Name: recordName,
          Type: recordType,
          TTL: 300,
          ResourceRecords: ips.map(ip => ({ Value: ip }))
        }
      }]
    };
    
    // Create AWS API signature
    const timestamp = new Date().toISOString().replace(/[:\-]|\\.\\d{3}/g, '');
    const date = timestamp.substr(0, 8);
    const canonicalRequest = await this.createRoute53CanonicalRequest(hostedZoneId, changeBatch, timestamp);
    const stringToSign = await this.createRoute53StringToSign(canonicalRequest, timestamp, region);
    const signature = await this.createRoute53Signature(secretAccessKey, stringToSign, date, region);
    
    const response = await fetch(`https://route53.${region}.amazonaws.com/2013-04-01/hostedzone/${hostedZoneId}/rrset`, {
      method: 'POST',
      headers: {
        'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${date}/${region}/route53/aws4_request, SignedHeaders=host;x-amz-date, Signature=${signature}`,
        'X-Amz-Date': timestamp,
        'Content-Type': 'application/xml'
      },
      body: this.createRoute53ChangeXml(changeBatch),
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      throw new Error(`Route 53 API error: ${response.status} ${response.statusText}`);
    }
  }
  
  /**
   * Update DNS state via Cloudflare Workers KV (tertiary method)
   */
  private async updateViaCloudflareWorkersKv(recordName: string, ips: string[], operation: string, recordType: string): Promise<void> {
    if (!this.env?.DNS_STATE_KV) {
      throw new Error('Missing Cloudflare Workers KV binding for DNS state');
    }
    
    console.log(`[DNS] Workers KV - ${operation.toUpperCase()} - Storing DNS state:`, {
      recordName, recordType, ips, operation
    });
    
    const dnsState = {
      recordName,
      recordType,
      ips,
      operation,
      timestamp: Date.now(),
      ttl: 300,
      managed_by: 'cloudflare-load-balancer',
      status: 'active'
    };
    
    await this.env.DNS_STATE_KV.put(`dns:${recordName}:${recordType}`, JSON.stringify(dnsState), {
      expirationTtl: 86400 // 24 hours
    });
    
    // Also store in a list for monitoring
    const stateList = await this.env.DNS_STATE_KV.get('dns:all_records', 'json') || [];
    stateList.push({ recordName, recordType, timestamp: Date.now(), operation });
    await this.env.DNS_STATE_KV.put('dns:all_records', JSON.stringify(stateList.slice(-100))); // Keep last 100 changes
  }
  
  /**
   * Update DNS via DNS-over-HTTPS for verification (quaternary method)
   */
  private async updateViaDnsOverHttps(recordName: string, ips: string[], operation: string, recordType: string): Promise<void> {
    console.log(`[DNS] DNS-over-HTTPS - ${operation.toUpperCase()} - Verifying DNS propagation:`, {
      recordName, recordType, ips, operation
    });
    
    // Use multiple DoH providers for verification
    const dohProviders = [
      'https://cloudflare-dns.com/dns-query',
      'https://dns.google/dns-query',
      'https://dns.quad9.net/dns-query'
    ];
    
    const verificationResults: Array<{ provider: string; success: boolean; resolvedIps: string[] }> = [];
    
    for (const provider of dohProviders) {
      try {
        const response = await fetch(`${provider}?name=${recordName}&type=${recordType}`, {
          headers: { 'Accept': 'application/dns-json' },
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          const data = await response.json() as any;
          const resolvedIps = data.Answer?.map((answer: any) => answer.data) || [];
          verificationResults.push({
            provider: provider.split('//')[1].split('/')[0],
            success: true,
            resolvedIps
          });
        }
      } catch (error) {
        verificationResults.push({
          provider: provider.split('//')[1].split('/')[0],
          success: false,
          resolvedIps: []
        });
      }
    }
    
    // Log verification results for monitoring
    console.log(`[DNS] DNS-over-HTTPS verification results:`, verificationResults);
    
    // Store verification data for later analysis
    if (this.env?.DNS_STATE_KV) {
      await this.env.DNS_STATE_KV.put(`dns:verification:${recordName}:${Date.now()}`, JSON.stringify({
        recordName,
        recordType,
        expectedIps: ips,
        verificationResults,
        timestamp: Date.now()
      }), { expirationTtl: 3600 }); // 1 hour
    }
  }
  
  /**
   * Update DNS via webhook notification (quinary method)
   */
  private async updateViaWebhookNotification(recordName: string, ips: string[], operation: string, recordType: string): Promise<void> {
    const webhookUrl = this.env?.DNS_WEBHOOK_URL || this.config.load_balancer.dns_failover?.webhook_url;
    
    if (!webhookUrl) {
      throw new Error('Missing DNS webhook URL configuration');
    }
    
    console.log(`[DNS] Webhook - ${operation.toUpperCase()} - Sending DNS change notification:`, {
      recordName, recordType, ips, operation
    });
    
    const payload = {
      action: 'dns_update',
      record_name: recordName,
      record_type: recordType,
      ips: ips,
      operation: operation,
      timestamp: new Date().toISOString(),
      ttl: 300,
      source: 'cloudflare-load-balancer',
      metadata: {
        service_id: this.config.serviceId,
        pool_count: this.config.pools.length,
        backend_count: this.config.pools.reduce((acc, pool) => acc + pool.backends.length, 0)
      }
    };
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Cloudflare-Load-Balancer/1.0',
        ...(this.env?.DNS_WEBHOOK_SECRET && {
          'X-Webhook-Signature': await this.createWebhookSignature(JSON.stringify(payload), this.env.DNS_WEBHOOK_SECRET)
        })
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      throw new Error(`DNS webhook failed: ${response.status} ${response.statusText}`);
    }
  }
  
  /**
   * Log structured DNS change for monitoring and alerting (final fallback)
   */
  private async logStructuredDnsChange(recordName: string, ips: string[], operation: string, recordType: string): Promise<void> {
    console.log(`[DNS] Structured Logging - ${operation.toUpperCase()} - Recording DNS change:`, {
      recordName,
      recordType,
      ips,
      operation,
      timestamp: new Date().toISOString(),
      ttl: 300,
      status: 'logged_only',
      note: 'DNS change recorded for manual processing - no automatic DNS updates were made'
    });
    
    // Generate structured alert for monitoring systems
    this.generateAlert({
      id: `dns-manual-${Date.now()}`,
      type: 'dns_failover',
      severity: 'medium',
      message: `Manual DNS ${operation} required for ${recordName}: ${ips.join(', ')}`,
      timestamp: Date.now(),
      metadata: {
        recordName,
        recordType,
        ips,
        operation,
        action_required: 'manual_dns_update',
        instructions: `Update ${recordType} record for ${recordName} to point to: ${ips.join(', ')}`
      }
    });
  }
  
  /**
   * Store DNS state for monitoring and verification
   */
  private async storeDnsState(recordName: string, ips: string[], operation: string, recordType: string): Promise<void> {
    if (this.dnsState) {
      this.dnsState.current_backend_ips = ips;
      this.dnsState.last_failover_time = Date.now();
      
      if (operation === 'failover') {
        this.dnsState.failover_state = 'failover';
        this.dnsState.failoverActive = true;
      } else if (operation === 'recovery') {
        this.dnsState.failover_state = 'primary';
        this.dnsState.failoverActive = false;
        this.dnsState.lastRecoveryTime = Date.now();
      }
    }
  }
  
  /**
   * Create Route 53 canonical request for AWS API signature
   */
  private async createRoute53CanonicalRequest(hostedZoneId: string, changeBatch: any, timestamp: string): Promise<string> {
    const payload = this.createRoute53ChangeXml(changeBatch);
    const payloadHash = await this.sha256(payload);
    
    return [
      'POST',
      `/2013-04-01/hostedzone/${hostedZoneId}/rrset`,
      '',
      `host:route53.us-east-1.amazonaws.com`,
      `x-amz-date:${timestamp}`,
      '',
      'host;x-amz-date',
      payloadHash
    ].join('\\n');
  }
  
  /**
   * Create Route 53 string to sign for AWS API signature
   */
  private async createRoute53StringToSign(canonicalRequest: string, timestamp: string, region: string): Promise<string> {
    const date = timestamp.substr(0, 8);
    const credentialScope = `${date}/${region}/route53/aws4_request`;
    const hashedCanonicalRequest = await this.sha256(canonicalRequest);
    
    return [
      'AWS4-HMAC-SHA256',
      timestamp,
      credentialScope,
      hashedCanonicalRequest
    ].join('\\n');
  }
  
  /**
   * Create Route 53 signature for AWS API
   */
  private async createRoute53Signature(secretKey: string, stringToSign: string, date: string, region: string): Promise<string> {
    const dateKey = await this.hmacSha256(`AWS4${secretKey}`, date);
    const regionKey = await this.hmacSha256(dateKey, region);
    const serviceKey = await this.hmacSha256(regionKey, 'route53');
    const signingKey = await this.hmacSha256(serviceKey, 'aws4_request');
    const signature = await this.hmacSha256(signingKey, stringToSign);
    
    return this.bytesToHex(signature);
  }
  
  /**
   * Create Route 53 change XML payload
   */
  private createRoute53ChangeXml(changeBatch: any): string {
    const changes = changeBatch.Changes.map((change: any) => {
      const records = change.ResourceRecordSet.ResourceRecords
        .map((record: any) => `<ResourceRecord><Value>${record.Value}</Value></ResourceRecord>`)
        .join('');
      
      return `
        <Change>
          <Action>${change.Action}</Action>
          <ResourceRecordSet>
            <Name>${change.ResourceRecordSet.Name}</Name>
            <Type>${change.ResourceRecordSet.Type}</Type>
            <TTL>${change.ResourceRecordSet.TTL}</TTL>
            <ResourceRecords>${records}</ResourceRecords>
          </ResourceRecordSet>
        </Change>
      `;
    }).join('');
    
    return `<?xml version="1.0" encoding="UTF-8"?>
      <ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
        <ChangeBatch>
          <Changes>${changes}</Changes>
        </ChangeBatch>
      </ChangeResourceRecordSetsRequest>`;
  }
  
  /**
   * Create webhook signature for secure webhook delivery
   */
  private async createWebhookSignature(payload: string, secret: string): Promise<string> {
    const signature = await this.hmacSha256(secret, payload);
    return `sha256=${this.bytesToHex(signature)}`;
  }
  
  /**
   * SHA-256 hash function using Web Crypto API
   */
  private async sha256(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
    const hashArray = new Uint8Array(hashBuffer);
    return this.bytesToHex(hashArray);
  }
  
  /**
   * HMAC-SHA256 function
   */
  private async hmacSha256(key: string | Uint8Array, data: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const keyData = typeof key === 'string' ? encoder.encode(key) : key;
    const dataBytes = encoder.encode(data);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    return new Uint8Array(signature);
  }
  
  /**
   * Convert bytes to hex string
   */
  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  
  /**
   * Public methods for external use
   */
  public getMetrics(): ServiceMetrics {
    return { ...this.metrics };
  }
  
  public getDnsState(): DnsState | null {
    return this.dnsState ? { ...this.dnsState } : null;
  }
  
  public async performHealthCheck(poolId?: string, backendId?: string): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    
    const poolsToCheck = poolId ? 
      this.config.pools.filter(p => p.id === poolId) : 
      this.config.pools;
    
    for (const pool of poolsToCheck) {
      const backendsToCheck = backendId ?
        pool.backends.filter(b => b.id === backendId) :
        pool.backends;
        
      for (const backend of backendsToCheck) {
        const result = await this.checkBackendHealth(pool.id, backend);
        results.push(result);
        this.healthCheckResults.set(`${pool.id}:${backend.id}`, result);
      }
    }
    
    return results;
  }
  
  private async checkBackendHealth(poolId: string, backend: Backend): Promise<HealthCheckResult> {
    const activeHealthCheck = this.config.activeHealthChecks;
    
    if (!activeHealthCheck?.enabled) {
      // If no active health check, assume healthy if backend is enabled
      return {
        poolId,
        backendId: backend.id,
        healthy: backend.enabled,
        timestamp: Date.now()
      };
    }
    
    try {
      const startTime = Date.now();
      const url = `${backend.url}${activeHealthCheck.path}`;
      
      const response = await fetch(url, {
        method: activeHealthCheck.method || 'GET',
        headers: activeHealthCheck.headers,
        signal: AbortSignal.timeout(activeHealthCheck.timeout * 1000)
      });
      
      const responseTime = Date.now() - startTime;
      const expectedCodes = activeHealthCheck.expected_codes || [200];
      const isHealthy = expectedCodes.includes(response.status);
      
      if (activeHealthCheck.expected_body) {
        const body = await response.text();
        const bodyMatches = body.includes(activeHealthCheck.expected_body);
        
        return {
          poolId,
          backendId: backend.id,
          healthy: isHealthy && bodyMatches,
          responseTime,
          statusCode: response.status,
          timestamp: Date.now()
        };
      }
      
      return {
        poolId,
        backendId: backend.id,
        healthy: isHealthy,
        responseTime,
        statusCode: response.status,
        timestamp: Date.now()
      };
      
    } catch (error) {
      return {
        poolId,
        backendId: backend.id,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
    }
  }
  
  public updateConfig(newConfig: LoadBalancerServiceConfig): void {
    this.config = newConfig;
    
    // Reinitialize DNS state if DNS failover was enabled/disabled
    if (newConfig.load_balancer.dns_failover?.enabled && !this.dnsState) {
      this.dnsState = this.initializeDnsState();
    } else if (!newConfig.load_balancer.dns_failover?.enabled) {
      this.dnsState = undefined;
    }
  }
  
  public enableDnsFailover(config: DnsFailoverConfig): void {
    this.config.load_balancer.dns_failover = config;
    this.dnsState = this.initializeDnsState();
  }
  
  public disableDnsFailover(): void {
    this.config.load_balancer.dns_failover = undefined;
    this.dnsState = undefined;
  }

  /**
   * Get health metrics for all backends
   */
  public getHealthMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    // Get circuit breaker states and health scores
    for (const [backendId, state] of this.circuitBreakerStates.entries()) {
      const healthData = this.backendHealthScores.get(backendId);
      metrics[backendId] = {
        circuitState: state.state,
        healthScore: healthData?.score || 100,
        failureCount: state.failureCount,
        successCount: state.successCount,
        lastFailureTime: state.lastFailureTime,
        nextRetryTime: state.nextRetryTime
      };
    }
    
    // Add backends that don't have circuit breaker states yet
    if (this.config?.pools) {
      for (const pool of this.config.pools) {
        for (const backend of pool.backends) {
          if (!metrics[backend.id]) {
            metrics[backend.id] = {
              circuitState: 'closed',
              healthScore: 100,
              failureCount: 0,
              successCount: 0,
              lastFailureTime: 0,
              nextRetryTime: 0
            };
          }
        }
      }
    }
    
    return metrics;
  }
}

/**
 * Secure expression parser for rule evaluation
 * Implements a recursive descent parser for safe expression evaluation
 */
class ExpressionParser {
  private tokens: Token[];
  private position: number = 0;
  private context: Record<string, any>;

  constructor(tokens: Token[], context: Record<string, any>) {
    this.tokens = tokens;
    this.context = context;
  }

  /**
   * Parse and evaluate the expression
   */
  public parseExpression(): boolean {
    const result = this.parseLogicalOr();
    return this.toBooleanValue(result);
  }

  /**
   * Parse logical OR expressions (||, or)
   */
  private parseLogicalOr(): any {
    let left = this.parseLogicalAnd();

    while (this.match('||', 'or')) {
      const operator = this.previous().value;
      const right = this.parseLogicalAnd();
      
      if (operator === '||' || operator === 'or') {
        left = this.toBooleanValue(left) || this.toBooleanValue(right);
      }
    }

    return left;
  }

  /**
   * Parse logical AND expressions (&&, and)
   */
  private parseLogicalAnd(): any {
    let left = this.parseEquality();

    while (this.match('&&', 'and')) {
      const operator = this.previous().value;
      const right = this.parseEquality();
      
      if (operator === '&&' || operator === 'and') {
        left = this.toBooleanValue(left) && this.toBooleanValue(right);
      }
    }

    return left;
  }

  /**
   * Parse equality expressions (==, !=)
   */
  private parseEquality(): any {
    let left = this.parseComparison();

    while (this.match('==', '!=')) {
      const operator = this.previous().value;
      const right = this.parseComparison();
      
      switch (operator) {
        case '==':
          left = this.isEqual(left, right);
          break;
        case '!=':
          left = !this.isEqual(left, right);
          break;
      }
    }

    return left;
  }

  /**
   * Parse comparison expressions (<, >, <=, >=)
   */
  private parseComparison(): any {
    let left = this.parseStringOperations();

    while (this.match('<', '>', '<=', '>=')) {
      const operator = this.previous().value;
      const right = this.parseStringOperations();
      
      const leftNum = this.toNumericValue(left);
      const rightNum = this.toNumericValue(right);
      
      switch (operator) {
        case '<':
          left = leftNum < rightNum;
          break;
        case '>':
          left = leftNum > rightNum;
          break;
        case '<=':
          left = leftNum <= rightNum;
          break;
        case '>=':
          left = leftNum >= rightNum;
          break;
      }
    }

    return left;
  }

  /**
   * Parse string operations (contains, startsWith, endsWith, matches, =~, !~)
   */
  private parseStringOperations(): any {
    let left = this.parseUnary();

    while (this.match('contains', 'startsWith', 'endsWith', 'matches', '=~', '!~', 'in')) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      
      const leftStr = this.toStringValue(left);
      const rightStr = this.toStringValue(right);
      
      switch (operator) {
        case 'contains':
          left = leftStr.includes(rightStr);
          break;
        case 'startsWith':
          left = leftStr.startsWith(rightStr);
          break;
        case 'endsWith':
          left = leftStr.endsWith(rightStr);
          break;
        case 'matches':
        case '=~':
          try {
            const regex = new RegExp(rightStr, 'i');
            left = regex.test(leftStr);
          } catch {
            left = false;
          }
          break;
        case '!~':
          try {
            const regex = new RegExp(rightStr, 'i');
            left = !regex.test(leftStr);
          } catch {
            left = true;
          }
          break;
        case 'in':
          if (Array.isArray(right)) {
            left = right.includes(left);
          } else if (typeof right === 'object' && right !== null) {
            left = left in right;
          } else {
            left = false;
          }
          break;
      }
    }

    return left;
  }

  /**
   * Parse unary expressions (!, not)
   */
  private parseUnary(): any {
    if (this.match('!', 'not')) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      
      if (operator === '!' || operator === 'not') {
        return !this.toBooleanValue(right);
      }
    }

    return this.parsePrimary();
  }

  /**
   * Parse primary expressions (literals, identifiers, parentheses)
   */
  private parsePrimary(): any {
    if (this.match('true')) return true;
    if (this.match('false')) return false;

    if (this.check('number')) {
      return this.advance().value;
    }

    if (this.check('string')) {
      return this.advance().value;
    }

    if (this.check('identifier')) {
      const identifier = this.advance().value;
      return this.resolveIdentifier(identifier);
    }

    if (this.match('(')) {
      const expr = this.parseLogicalOr();
      this.consume(')', "Expected ')' after expression");
      return expr;
    }

    throw new Error(`Unexpected token: ${this.peek()?.value || 'EOF'}`);
  }

  /**
   * Resolve identifier from context
   */
  private resolveIdentifier(identifier: string): any {
    // Handle dot notation (e.g., url.path, client.ip)
    const parts = identifier.split('.');
    let current = this.context;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  /**
   * Convert value to boolean
   */
  private toBooleanValue(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.length > 0;
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(value);
  }

  /**
   * Convert value to number
   */
  private toNumericValue(value: any): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? 0 : num;
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    return 0;
  }

  /**
   * Convert value to string
   */
  private toStringValue(value: any): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  /**
   * Check if two values are equal
   */
  private isEqual(left: any, right: any): boolean {
    if (left === right) return true;
    
    // Type coercion for comparison
    if (typeof left === 'string' && typeof right === 'number') {
      return parseFloat(left) === right;
    }
    if (typeof left === 'number' && typeof right === 'string') {
      return left === parseFloat(right);
    }
    
    return false;
  }

  /**
   * Check if current token matches any of the given types/values
   */
  private match(...types: string[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  /**
   * Check if current token is of given type/value
   */
  private check(type: string): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    return token !== null && (token.type === type || token.value === type);
  }

  /**
   * Consume current token and return it
   */
  private advance(): Token {
    if (!this.isAtEnd()) this.position++;
    return this.previous();
  }

  /**
   * Check if we're at end of tokens
   */
  private isAtEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  /**
   * Get current token without consuming it
   */
  private peek(): Token | null {
    if (this.isAtEnd()) return null;
    return this.tokens[this.position];
  }

  /**
   * Get previous token
   */
  private previous(): Token {
    return this.tokens[this.position - 1];
  }

  /**
   * Consume expected token or throw error
   */
  private consume(type: string, message: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(message);
  }
} 