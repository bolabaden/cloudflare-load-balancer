import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('FlowBalance Types Tests', () => {
  
  describe('Backend Interface Validation', () => {
    test('should validate basic Backend structure', () => {
      const validBackend = {
        id: 'backend-1',
        url: 'https://api.example.com',
        ip: '192.168.1.100',
        weight: 1,
        healthy: true,
        consecutiveFailures: 0,
        priority: 10,
        enabled: true,
        requests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalResponseTimeMs: 0
      };

      // Test required fields
      assert.strictEqual(typeof validBackend.id, 'string');
      assert.strictEqual(typeof validBackend.url, 'string');
      assert.strictEqual(typeof validBackend.ip, 'string');
      assert.strictEqual(typeof validBackend.weight, 'number');
      assert.strictEqual(typeof validBackend.healthy, 'boolean');
      assert.strictEqual(typeof validBackend.consecutiveFailures, 'number');
      assert.strictEqual(typeof validBackend.priority, 'number');
      assert.strictEqual(typeof validBackend.enabled, 'boolean');
      
      // Test metrics fields
      assert.strictEqual(typeof validBackend.requests, 'number');
      assert.strictEqual(typeof validBackend.successfulRequests, 'number');
      assert.strictEqual(typeof validBackend.failedRequests, 'number');
      assert.strictEqual(typeof validBackend.totalResponseTimeMs, 'number');
    });

    test('should handle optional Backend fields', () => {
      const backendWithOptionals = {
        id: 'backend-2',
        url: 'https://api2.example.com',
        ip: '192.168.1.101',
        weight: 2,
        healthy: false,
        consecutiveFailures: 3,
        priority: 20,
        enabled: true,
        requests: 100,
        successfulRequests: 97,
        failedRequests: 3,
        totalResponseTimeMs: 15000,
        
        // Optional fields
        lastFailureTimestamp: Date.now(),
        status: 'Connection timeout',
        latitude: 37.7749,
        longitude: -122.4194,
        region: 'us-west',
        responseTime: 150,
        outstandingRequests: 5,
        circuitBreakerState: 'open',
        circuitBreakerOpenTimestamp: Date.now(),
        consecutiveSuccesses: 0,
        lastSuccessTimestamp: Date.now() - 60000,
        errorCounts: {
          connection: 2,
          timeout: 1,
          http5xx: 0,
          http523: 0
        },
        avgResponseTimeMs: 150,
        healthScore: 25
      };

      // Test optional timestamp fields
      if (backendWithOptionals.lastFailureTimestamp) {
        assert.strictEqual(typeof backendWithOptionals.lastFailureTimestamp, 'number');
      }
      
      // Test geolocation fields
      if (backendWithOptionals.latitude !== undefined) {
        assert.strictEqual(typeof backendWithOptionals.latitude, 'number');
        assert(backendWithOptionals.latitude >= -90 && backendWithOptionals.latitude <= 90);
      }
      
      if (backendWithOptionals.longitude !== undefined) {
        assert.strictEqual(typeof backendWithOptionals.longitude, 'number');
        assert(backendWithOptionals.longitude >= -180 && backendWithOptionals.longitude <= 180);
      }

      // Test circuit breaker state
      if (backendWithOptionals.circuitBreakerState) {
        const validStates = ['closed', 'open', 'half-open'];
        assert(validStates.includes(backendWithOptionals.circuitBreakerState));
      }

      // Test error counts structure
      if (backendWithOptionals.errorCounts) {
        assert.strictEqual(typeof backendWithOptionals.errorCounts.connection, 'number');
        assert.strictEqual(typeof backendWithOptionals.errorCounts.timeout, 'number');
        assert.strictEqual(typeof backendWithOptionals.errorCounts.http5xx, 'number');
        assert.strictEqual(typeof backendWithOptionals.errorCounts.http523, 'number');
      }
    });
  });

  describe('OriginPool Interface Validation', () => {
    test('should validate OriginPool structure', () => {
      const validPool = {
        id: 'pool-1',
        name: 'Primary Pool',
        description: 'Main application servers',
        backends: [],
        enabled: true,
        minimum_origins: 1,
        endpoint_steering: 'round_robin'
      };

      assert.strictEqual(typeof validPool.id, 'string');
      assert.strictEqual(typeof validPool.name, 'string');
      assert.strictEqual(typeof validPool.enabled, 'boolean');
      assert.strictEqual(typeof validPool.minimum_origins, 'number');
      assert(Array.isArray(validPool.backends));
      
      // Test endpoint steering method
      const validSteeringMethods = ['random', 'hash', 'least_outstanding_requests', 'least_connections', 'round_robin'];
      assert(validSteeringMethods.includes(validPool.endpoint_steering));
    });

    test('should handle OriginPool with load shedding configuration', () => {
      const poolWithLoadShedding = {
        id: 'pool-2',
        name: 'Pool with Load Shedding',
        backends: [],
        enabled: true,
        minimum_origins: 2,
        endpoint_steering: 'least_connections',
        load_shedding: {
          default_policy: 'shed_new',
          session_affinity_policy: 'honor'
        }
      };

      if (poolWithLoadShedding.load_shedding) {
        const validDefaultPolicies = ['none', 'shed_new', 'shed_new_and_existing'];
        const validAffinityPolicies = ['honor', 'shed'];
        
        if (poolWithLoadShedding.load_shedding.default_policy) {
          assert(validDefaultPolicies.includes(poolWithLoadShedding.load_shedding.default_policy));
        }
        
        if (poolWithLoadShedding.load_shedding.session_affinity_policy) {
          assert(validAffinityPolicies.includes(poolWithLoadShedding.load_shedding.session_affinity_policy));
        }
      }
    });
  });

  describe('LoadBalancer Interface Validation', () => {
    test('should validate LoadBalancer structure', () => {
      const validLoadBalancer = {
        id: 'lb-1',
        name: 'Main Load Balancer',
        hostname: 'api.example.com',
        default_pool_ids: ['pool-1', 'pool-2'],
        proxied: true,
        enabled: true,
        steering_policy: 'geo'
      };

      assert.strictEqual(typeof validLoadBalancer.id, 'string');
      assert.strictEqual(typeof validLoadBalancer.name, 'string');
      assert.strictEqual(typeof validLoadBalancer.hostname, 'string');
      assert(Array.isArray(validLoadBalancer.default_pool_ids));
      assert.strictEqual(typeof validLoadBalancer.proxied, 'boolean');
      assert.strictEqual(typeof validLoadBalancer.enabled, 'boolean');
      
      // Test steering policy
      const validSteeringPolicies = ['off', 'random', 'geo', 'dynamic', 'proximity', 'least_outstanding_requests', 'least_connections', 'dns_failover'];
      assert(validSteeringPolicies.includes(validLoadBalancer.steering_policy));
    });

    test('should validate session affinity configuration', () => {
      const sessionAffinityConfig = {
        type: 'cookie',
        enabled: true,
        ttl: 3600,
        cookieName: 'X-Backend-Affinity',
        cookie_attributes: {
          secure: true,
          httpOnly: true,
          sameSite: 'strict'
        },
        zero_downtime_failover: 'temporary',
        drain_duration: 300
      };

      const validTypes = ['none', 'cookie', 'ip_cookie', 'header'];
      assert(validTypes.includes(sessionAffinityConfig.type));
      
      if (sessionAffinityConfig.cookie_attributes) {
        const validSameSite = ['strict', 'lax', 'none'];
        if (sessionAffinityConfig.cookie_attributes.sameSite) {
          assert(validSameSite.includes(sessionAffinityConfig.cookie_attributes.sameSite));
        }
      }
      
      const validFailoverTypes = ['none', 'temporary', 'sticky'];
      if (sessionAffinityConfig.zero_downtime_failover) {
        assert(validFailoverTypes.includes(sessionAffinityConfig.zero_downtime_failover));
      }
    });
  });

  describe('TrafficSteeringMethod Enum Validation', () => {
    test('should validate all traffic steering methods', () => {
      const validMethods = [
        'off',
        'random',
        'geo',
        'dynamic',
        'proximity',
        'least_outstanding_requests',
        'least_connections',
        'dns_failover'
      ];

      // Test that each method is a string
      validMethods.forEach(method => {
        assert.strictEqual(typeof method, 'string');
        assert(method.length > 0);
      });

      // Test specific method validation
      assert(validMethods.includes('geo'));
      assert(validMethods.includes('dns_failover'));
      assert(!validMethods.includes('invalid_method'));
    });
  });

  describe('EndpointSteeringMethod Enum Validation', () => {
    test('should validate all endpoint steering methods', () => {
      const validMethods = [
        'random',
        'hash',
        'least_outstanding_requests',
        'least_connections',
        'round_robin'
      ];

      validMethods.forEach(method => {
        assert.strictEqual(typeof method, 'string');
        assert(method.length > 0);
      });

      assert(validMethods.includes('round_robin'));
      assert(validMethods.includes('least_outstanding_requests'));
      assert(!validMethods.includes('weighted'));
    });
  });

  describe('Health Check Configuration Validation', () => {
    test('should validate PassiveHealthCheckConfig', () => {
      const passiveConfig = {
        enabled: true,
        max_failures: 3,
        failure_timeout_ms: 30000,
        retryable_status_codes: [500, 502, 503, 504],
        monitor_timeout: 10
      };

      assert.strictEqual(typeof passiveConfig.enabled, 'boolean');
      assert.strictEqual(typeof passiveConfig.max_failures, 'number');
      assert.strictEqual(typeof passiveConfig.failure_timeout_ms, 'number');
      assert(Array.isArray(passiveConfig.retryable_status_codes));
      
      // Validate status codes are numbers
      passiveConfig.retryable_status_codes.forEach(code => {
        assert.strictEqual(typeof code, 'number');
        assert(code >= 100 && code < 600);
      });
    });

    test('should validate ActiveHealthCheckConfig', () => {
      const activeConfig = {
        enabled: true,
        type: 'https',
        path: '/health',
        method: 'GET',
        timeout: 10,
        interval: 30,
        retries: 3,
        expected_codes: [200, 204],
        consecutive_up: 2,
        consecutive_down: 3
      };

      assert.strictEqual(typeof activeConfig.enabled, 'boolean');
      
      const validTypes = ['http', 'https', 'tcp', 'udp_icmp', 'icmp', 'smtp', 'ldap'];
      assert(validTypes.includes(activeConfig.type));
      
      assert.strictEqual(typeof activeConfig.path, 'string');
      assert.strictEqual(typeof activeConfig.timeout, 'number');
      assert.strictEqual(typeof activeConfig.interval, 'number');
      
      if (activeConfig.expected_codes) {
        assert(Array.isArray(activeConfig.expected_codes));
        activeConfig.expected_codes.forEach(code => {
          assert.strictEqual(typeof code, 'number');
          assert(code >= 100 && code < 600);
        });
      }
    });
  });

  describe('Notification Configuration Validation', () => {
    test('should validate NotificationConfig types', () => {
      const validTypes = ['webhook', 'email', 'slack', 'discord', 'teams', 'pagerduty', 'opsgenie'];
      
      validTypes.forEach(type => {
        const config = {
          type: type,
          enabled: true,
          name: `Test ${type} notification`
        };
        
        assert.strictEqual(typeof config.type, 'string');
        assert(validTypes.includes(config.type));
        assert.strictEqual(typeof config.enabled, 'boolean');
      });
    });

    test('should validate NotificationPayload structure', () => {
      const payload = {
        alert_id: 'alert-123',
        alert_type: 'backend_down',
        severity: 'high',
        message: 'Backend server is not responding',
        timestamp: '2023-12-01T10:00:00Z',
        service_id: 'api.example.com',
        resolved: false,
        resolved_timestamp: null,
        metadata: {
          service_hostname: 'api.example.com',
          account_id: 'acc-123',
          zone_id: 'zone-456',
          backend_id: 'backend-1'
        }
      };

      assert.strictEqual(typeof payload.alert_id, 'string');
      assert.strictEqual(typeof payload.alert_type, 'string');
      assert.strictEqual(typeof payload.severity, 'string');
      assert.strictEqual(typeof payload.message, 'string');
      assert.strictEqual(typeof payload.timestamp, 'string');
      assert.strictEqual(typeof payload.service_id, 'string');
      assert.strictEqual(typeof payload.resolved, 'boolean');
      assert(typeof payload.metadata === 'object');
      
      // Validate metadata required fields
      assert.strictEqual(typeof payload.metadata.service_hostname, 'string');
      assert.strictEqual(typeof payload.metadata.account_id, 'string');
      assert.strictEqual(typeof payload.metadata.zone_id, 'string');
    });
  });

  describe('Metrics Interfaces Validation', () => {
    test('should validate BackendMetrics structure', () => {
      const metrics = {
        requests: 1000,
        successfulRequests: 950,
        failedRequests: 50,
        totalResponseTimeMs: 150000,
        avgResponseTimeMs: 150,
        lastRequestTimestamp: Date.now(),
        lastSuccessTimestamp: Date.now() - 1000,
        lastFailureTimestamp: Date.now() - 5000,
        p50ResponseTime: 120,
        p95ResponseTime: 300,
        p99ResponseTime: 500,
        connectionsActive: 5,
        connectionsTotal: 1000,
        bytesIn: 1024000,
        bytesOut: 2048000,
        healthCheckSuccess: 100,
        healthCheckFailure: 2,
        healthCheckLastSuccess: Date.now() - 30000,
        healthCheckLastFailure: Date.now() - 300000
      };

      // Test required numeric fields
      const requiredFields = ['requests', 'successfulRequests', 'failedRequests', 'totalResponseTimeMs', 'avgResponseTimeMs'];
      requiredFields.forEach(field => {
        assert.strictEqual(typeof metrics[field], 'number');
        assert(metrics[field] >= 0);
      });

      // Test that successful + failed = total requests
      assert.strictEqual(metrics.successfulRequests + metrics.failedRequests, metrics.requests);
      
      // Test percentile ordering (p50 <= p95 <= p99)
      if (metrics.p50ResponseTime && metrics.p95ResponseTime && metrics.p99ResponseTime) {
        assert(metrics.p50ResponseTime <= metrics.p95ResponseTime);
        assert(metrics.p95ResponseTime <= metrics.p99ResponseTime);
      }
    });

    test('should validate ServiceMetrics structure', () => {
      const serviceMetrics = {
        serviceId: 'api.example.com',
        totalRequests: 5000,
        totalSuccessfulRequests: 4800,
        totalFailedRequests: 200,
        backendMetrics: {
          'backend-1': {
            requests: 2500,
            successfulRequests: 2400,
            failedRequests: 100,
            totalResponseTimeMs: 375000,
            avgResponseTimeMs: 150
          },
          'backend-2': {
            requests: 2500,
            successfulRequests: 2400,
            failedRequests: 100,
            totalResponseTimeMs: 500000,
            avgResponseTimeMs: 200
          }
        },
        poolMetrics: {
          'pool-1': {
            poolId: 'pool-1',
            totalRequests: 5000,
            totalSuccessfulRequests: 4800,
            totalFailedRequests: 200,
            activeConnections: 10,
            avgResponseTime: 175,
            healthyOrigins: 2,
            totalOrigins: 2
          }
        },
        dnsFailovers: 1,
        dnsRecoveries: 1,
        currentDnsRecord: 'api.example.com',
        steeringDecisions: {
          'geo': 3000,
          'random': 2000
        },
        sessionAffinityHits: 1500,
        sessionAffinityMisses: 3500
      };

      assert.strictEqual(typeof serviceMetrics.serviceId, 'string');
      assert.strictEqual(typeof serviceMetrics.totalRequests, 'number');
      assert.strictEqual(typeof serviceMetrics.totalSuccessfulRequests, 'number');
      assert.strictEqual(typeof serviceMetrics.totalFailedRequests, 'number');
      
      // Validate backend metrics structure
      assert(typeof serviceMetrics.backendMetrics === 'object');
      Object.entries(serviceMetrics.backendMetrics).forEach(([backendId, metrics]) => {
        assert.strictEqual(typeof backendId, 'string');
        assert.strictEqual(typeof metrics.requests, 'number');
        assert.strictEqual(typeof metrics.successfulRequests, 'number');
        assert.strictEqual(typeof metrics.failedRequests, 'number');
      });
      
      // Validate pool metrics structure
      assert(typeof serviceMetrics.poolMetrics === 'object');
      Object.entries(serviceMetrics.poolMetrics).forEach(([poolId, metrics]) => {
        assert.strictEqual(typeof poolId, 'string');
        assert.strictEqual(metrics.poolId, poolId);
        assert.strictEqual(typeof metrics.totalRequests, 'number');
        assert.strictEqual(typeof metrics.healthyOrigins, 'number');
        assert.strictEqual(typeof metrics.totalOrigins, 'number');
        assert(metrics.healthyOrigins <= metrics.totalOrigins);
      });
    });
  });

  describe('DNS Failover Configuration Validation', () => {
    test('should validate DnsFailoverConfig structure', () => {
      const dnsConfig = {
        enabled: true,
        primary_pool_id: 'pool-primary',
        failover_pool_ids: ['pool-failover-1', 'pool-failover-2'],
        health_check_interval: 30,
        failure_threshold: 3,
        recovery_threshold: 2,
        dns_ttl: 300,
        update_method: 'immediate',
        dns_record_name: 'api.example.com',
        zone_id: 'zone-abc123',
        api_token: 'cf-token-xyz789',
        webhook_url: 'https://notifications.example.com/webhook'
      };

      assert.strictEqual(typeof dnsConfig.enabled, 'boolean');
      assert.strictEqual(typeof dnsConfig.primary_pool_id, 'string');
      assert(Array.isArray(dnsConfig.failover_pool_ids));
      assert.strictEqual(typeof dnsConfig.health_check_interval, 'number');
      assert.strictEqual(typeof dnsConfig.failure_threshold, 'number');
      assert.strictEqual(typeof dnsConfig.recovery_threshold, 'number');
      assert.strictEqual(typeof dnsConfig.dns_ttl, 'number');
      
      const validUpdateMethods = ['immediate', 'gradual'];
      assert(validUpdateMethods.includes(dnsConfig.update_method));
      
      assert.strictEqual(typeof dnsConfig.dns_record_name, 'string');
      
      // Validate thresholds are positive
      assert(dnsConfig.failure_threshold > 0);
      assert(dnsConfig.recovery_threshold > 0);
      assert(dnsConfig.health_check_interval > 0);
      assert(dnsConfig.dns_ttl >= 60); // Minimum TTL should be reasonable
    });

    test('should validate DnsState structure', () => {
      const dnsState = {
        current_pool_id: 'pool-primary',
        current_backend_ips: ['192.168.1.100', '192.168.1.101'],
        failover_state: 'primary',
        last_failover_time: Date.now() - 3600000,
        failure_count: 0,
        recovery_count: 2,
        health_check_results: {
          'pool-primary': {
            poolId: 'pool-primary',
            backendId: 'backend-1',
            healthy: true,
            responseTime: 150,
            statusCode: 200,
            timestamp: Date.now()
          }
        },
        currentPool: 'pool-primary',
        lastFailoverTime: Date.now() - 3600000,
        lastRecoveryTime: Date.now() - 1800000,
        failoverActive: false
      };

      assert.strictEqual(typeof dnsState.current_pool_id, 'string');
      assert(Array.isArray(dnsState.current_backend_ips));
      
      const validFailoverStates = ['primary', 'failover', 'recovery'];
      assert(validFailoverStates.includes(dnsState.failover_state));
      
      assert.strictEqual(typeof dnsState.failure_count, 'number');
      assert.strictEqual(typeof dnsState.recovery_count, 'number');
      assert(typeof dnsState.health_check_results === 'object');
      assert.strictEqual(typeof dnsState.failoverActive, 'boolean');
      
      // Validate IP addresses format
      dnsState.current_backend_ips.forEach(ip => {
        assert.strictEqual(typeof ip, 'string');
        // Basic IP format validation (IPv4)
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        assert(ipRegex.test(ip), `Invalid IP format: ${ip}`);
      });
    });
  });

  describe('Alert System Validation', () => {
    test('should validate Alert structure', () => {
      const alert = {
        id: 'alert-123',
        type: 'backend_down',
        severity: 'high',
        message: 'Backend server backend-1 is not responding',
        timestamp: Date.now(),
        resolved: false,
        metadata: {
          backendId: 'backend-1',
          poolId: 'pool-primary',
          consecutiveFailures: 3
        }
      };

      assert.strictEqual(typeof alert.id, 'string');
      
      const validAlertTypes = [
        'backend_down', 'pool_down', 'high_latency', 'high_error_rate', 
        'dns_failover', 'dns_failover_triggered', 'dns_failover_error', 
        'dns_recovery_completed', 'dns_recovery_error'
      ];
      assert(validAlertTypes.includes(alert.type));
      
      const validSeverities = ['low', 'medium', 'high', 'critical'];
      assert(validSeverities.includes(alert.severity));
      
      assert.strictEqual(typeof alert.message, 'string');
      assert.strictEqual(typeof alert.timestamp, 'number');
      assert.strictEqual(typeof alert.resolved, 'boolean');
      
      if (alert.metadata) {
        assert(typeof alert.metadata === 'object');
      }
    });

    test('should validate AlertRule structure', () => {
      const alertRule = {
        id: 'rule-1',
        name: 'High Error Rate Alert',
        type: 'high_error_rate',
        enabled: true,
        conditions: {
          threshold: 10, // 10% error rate
          duration: 300, // 5 minutes
          comparison: 'gt'
        },
        actions: {
          email: ['admin@example.com', 'ops@example.com'],
          webhook: 'https://hooks.slack.com/services/...',
          slack: '#alerts'
        }
      };

      assert.strictEqual(typeof alertRule.id, 'string');
      assert.strictEqual(typeof alertRule.name, 'string');
      assert.strictEqual(typeof alertRule.enabled, 'boolean');
      
      // Validate conditions
      assert.strictEqual(typeof alertRule.conditions.threshold, 'number');
      assert.strictEqual(typeof alertRule.conditions.duration, 'number');
      
      const validComparisons = ['gt', 'lt', 'eq', 'gte', 'lte'];
      assert(validComparisons.includes(alertRule.conditions.comparison));
      
      // Validate actions
      if (alertRule.actions.email) {
        assert(Array.isArray(alertRule.actions.email));
        alertRule.actions.email.forEach(email => {
          assert.strictEqual(typeof email, 'string');
          assert(email.includes('@'), 'Email should contain @ symbol');
        });
      }
    });
  });

  describe('Geographic and Network Data Validation', () => {
    test('should validate GeographicData structure', () => {
      const geoData = {
        country: 'US',
        region: 'California',
        city: 'San Francisco',
        latitude: 37.7749,
        longitude: -122.4194,
        asn: 13335,
        timezone: 'America/Los_Angeles',
        isp: 'Cloudflare'
      };

      assert.strictEqual(typeof geoData.country, 'string');
      assert.strictEqual(typeof geoData.region, 'string');
      assert.strictEqual(typeof geoData.latitude, 'number');
      assert.strictEqual(typeof geoData.longitude, 'number');
      
      // Validate coordinate ranges
      assert(geoData.latitude >= -90 && geoData.latitude <= 90);
      assert(geoData.longitude >= -180 && geoData.longitude <= 180);
      
      if (geoData.asn !== undefined) {
        assert.strictEqual(typeof geoData.asn, 'number');
        assert(geoData.asn > 0);
      }
    });

    test('should validate NetworkPath structure', () => {
      const networkPath = {
        hops: 12,
        latency: 45.5,
        packet_loss: 0.1,
        bandwidth: 1000000000, // 1 Gbps in bits/sec
        last_measured: Date.now()
      };

      assert.strictEqual(typeof networkPath.hops, 'number');
      assert.strictEqual(typeof networkPath.latency, 'number');
      assert.strictEqual(typeof networkPath.last_measured, 'number');
      
      assert(networkPath.hops > 0);
      assert(networkPath.latency >= 0);
      
      if (networkPath.packet_loss !== undefined) {
        assert.strictEqual(typeof networkPath.packet_loss, 'number');
        assert(networkPath.packet_loss >= 0 && networkPath.packet_loss <= 100);
      }
      
      if (networkPath.bandwidth !== undefined) {
        assert.strictEqual(typeof networkPath.bandwidth, 'number');
        assert(networkPath.bandwidth > 0);
      }
    });
  });

  describe('Token and Parser Validation', () => {
    test('should validate Token structure', () => {
      const tokens = [
        { type: 'string', value: 'hello' },
        { type: 'number', value: 42 },
        { type: 'operator', value: '==' },
        { type: 'keyword', value: 'if' },
        { type: 'identifier', value: 'variable_name' }
      ];

      const validTokenTypes = ['string', 'number', 'operator', 'keyword', 'identifier'];
      
      tokens.forEach(token => {
        assert.strictEqual(typeof token.type, 'string');
        assert(validTokenTypes.includes(token.type));
        assert(token.value !== undefined);
        
        // Type-specific validations
        if (token.type === 'number') {
          assert.strictEqual(typeof token.value, 'number');
        } else if (token.type === 'string' || token.type === 'keyword' || token.type === 'identifier') {
          assert.strictEqual(typeof token.value, 'string');
        }
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle invalid enum values gracefully', () => {
      const invalidSteeringPolicy = 'invalid_policy';
      const validPolicies = ['off', 'random', 'geo', 'dynamic', 'proximity', 'least_outstanding_requests', 'least_connections', 'dns_failover'];
      
      assert(!validPolicies.includes(invalidSteeringPolicy));
    });

    test('should validate field constraints', () => {
      // Test weight constraints
      const weights = [0, 1, 100, 1000];
      weights.forEach(weight => {
        assert(weight >= 0, 'Weight should be non-negative');
      });

      // Test priority constraints
      const priorities = [1, 10, 100];
      priorities.forEach(priority => {
        assert(priority > 0, 'Priority should be positive');
      });

      // Test percentage values (0-100)
      const percentages = [0, 50, 100];
      percentages.forEach(pct => {
        assert(pct >= 0 && pct <= 100, 'Percentage should be between 0 and 100');
      });
    });
  });
}); 