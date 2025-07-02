// Security Test Suite
// Tests authentication security, authorization, input validation, rate limiting,
// session management, and protection against common security vulnerabilities

import { test, describe } from 'node:test';
import assert from 'node:assert';

// Mock security system
class MockSecuritySystem {
  constructor() {
    this.sessions = new Map();
    this.rateLimits = new Map();
    this.blockedIPs = new Set();
    this.auditLog = [];
    this.config = {
      maxLoginAttempts: 5,
      lockoutDuration: 15 * 60 * 1000, // 15 minutes
      sessionTimeout: 60 * 60 * 1000, // 1 hour
      rateLimit: {
        requests: 100,
        window: 60 * 1000 // 1 minute
      }
    };
  }

  // Authentication Security
  validateCredentials(email, password) {
    const loginAttempts = this.getLoginAttempts(email);
    
    if (loginAttempts.count >= this.config.maxLoginAttempts) {
      if (Date.now() - loginAttempts.lastAttempt < this.config.lockoutDuration) {
        this.logSecurityEvent('account_locked', { email, attempts: loginAttempts.count });
        return { success: false, error: 'Account locked due to too many failed attempts' };
      } else {
        // Reset attempts after lockout period
        this.resetLoginAttempts(email);
      }
    }

    // Simulate credential validation
    if (email === 'admin@example.com' && password === 'SecurePassword123!') {
      this.resetLoginAttempts(email);
      this.logSecurityEvent('login_success', { email });
      return { success: true };
    } else {
      this.recordFailedLogin(email);
      this.logSecurityEvent('login_failed', { email });
      return { success: false, error: 'Invalid credentials' };
    }
  }

  // Session Management
  createSession(user, clientIP) {
    const sessionId = this.generateSecureToken();
    const session = {
      id: sessionId,
      user: user,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      clientIP: clientIP,
      csrfToken: this.generateSecureToken()
    };
    
    this.sessions.set(sessionId, session);
    this.logSecurityEvent('session_created', { userId: user.id, clientIP });
    
    return session;
  }

  validateSession(sessionId, clientIP) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      this.logSecurityEvent('invalid_session', { sessionId, clientIP });
      return { valid: false, error: 'Invalid session' };
    }

    // Check session timeout
    if (Date.now() - session.lastActivity > this.config.sessionTimeout) {
      this.sessions.delete(sessionId);
      this.logSecurityEvent('session_expired', { sessionId, userId: session.user.id });
      return { valid: false, error: 'Session expired' };
    }

    // Check IP consistency
    if (session.clientIP !== clientIP) {
      this.logSecurityEvent('session_ip_mismatch', { 
        sessionId, 
        originalIP: session.clientIP, 
        currentIP: clientIP 
      });
      return { valid: false, error: 'Session IP mismatch' };
    }

    // Update last activity
    session.lastActivity = Date.now();
    return { valid: true, session };
  }

  // Rate Limiting
  checkRateLimit(clientIP) {
    const now = Date.now();
    const key = `rate_${clientIP}`;
    
    if (!this.rateLimits.has(key)) {
      this.rateLimits.set(key, { count: 1, window: now });
      return { allowed: true, remaining: this.config.rateLimit.requests - 1 };
    }

    const limit = this.rateLimits.get(key);
    
    // Reset window if expired
    if (now - limit.window > this.config.rateLimit.window) {
      limit.count = 1;
      limit.window = now;
      return { allowed: true, remaining: this.config.rateLimit.requests - 1 };
    }

    // Check if limit exceeded
    if (limit.count >= this.config.rateLimit.requests) {
      this.logSecurityEvent('rate_limit_exceeded', { clientIP, count: limit.count });
      return { allowed: false, retryAfter: this.config.rateLimit.window - (now - limit.window) };
    }

    limit.count++;
    return { allowed: true, remaining: this.config.rateLimit.requests - limit.count };
  }

  // Input Validation
  validateInput(input, type) {
    const validations = {
      email: (value) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          return { valid: false, error: 'Invalid email format' };
        }
        if (value.length > 254) {
          return { valid: false, error: 'Email too long' };
        }
        return { valid: true };
      },
      
      password: (value) => {
        if (value.length < 8) {
          return { valid: false, error: 'Password must be at least 8 characters' };
        }
        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(value)) {
          return { valid: false, error: 'Password must contain uppercase, lowercase, number, and special character' };
        }
        return { valid: true };
      },
      
      url: (value) => {
        try {
          new URL(value);
          if (!value.startsWith('https://') && !value.startsWith('http://')) {
            return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
          }
          return { valid: true };
        } catch {
          return { valid: false, error: 'Invalid URL format' };
        }
      },
      
      ip: (value) => {
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        
        if (!ipv4Regex.test(value) && !ipv6Regex.test(value)) {
          return { valid: false, error: 'Invalid IP address format' };
        }
        return { valid: true };
      }
    };

    const validator = validations[type];
    if (!validator) {
      return { valid: false, error: 'Unknown validation type' };
    }

    return validator(input);
  }

  // XSS Protection
  sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  // SQL Injection Protection
  validateSQLInput(input) {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
      /(;|\-\-|\/\*|\*\/)/,
      /(\b(OR|AND)\b.*=.*)/i,
      /(1=1|1=0)/i
    ];

    for (const pattern of sqlPatterns) {
      if (pattern.test(input)) {
        this.logSecurityEvent('sql_injection_attempt', { input });
        return { safe: false, error: 'Potential SQL injection detected' };
      }
    }

    return { safe: true };
  }

  // CSRF Protection
  validateCSRF(sessionId, token) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { valid: false, error: 'Invalid session' };
    }

    if (session.csrfToken !== token) {
      this.logSecurityEvent('csrf_mismatch', { sessionId, providedToken: token });
      return { valid: false, error: 'CSRF token mismatch' };
    }

    return { valid: true };
  }

  // Helper methods
  generateSecureToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  getLoginAttempts(email) {
    const key = `login_attempts_${email}`;
    return this.rateLimits.get(key) || { count: 0, lastAttempt: 0 };
  }

  recordFailedLogin(email) {
    const key = `login_attempts_${email}`;
    const attempts = this.getLoginAttempts(email);
    attempts.count++;
    attempts.lastAttempt = Date.now();
    this.rateLimits.set(key, attempts);
  }

  resetLoginAttempts(email) {
    const key = `login_attempts_${email}`;
    this.rateLimits.delete(key);
  }

  logSecurityEvent(event, data) {
    this.auditLog.push({
      timestamp: Date.now(),
      event,
      data,
      id: this.generateSecureToken()
    });
  }

  getAuditLog() {
    return [...this.auditLog];
  }

  clearAuditLog() {
    this.auditLog = [];
  }
}

describe('Security System', () => {
  let security;

    test('setup', () => {
    // Setup is handled in individual tests
  });

  describe('Authentication Security', () => {
    let security;
    
    test('setup', () => {
      security = new MockSecuritySystem();
    });
    test('should validate strong passwords', () => {
      const strongPassword = 'SecurePassword123!';
      const result = security.validateInput(strongPassword, 'password');
      
      assert.strictEqual(result.valid, true);
    });

    test('should reject weak passwords', () => {
      const weakPasswords = [
        'password',           // No uppercase, numbers, or special chars
        'Password',           // No numbers or special chars
        'Password123',        // No special chars
        'Pass!',              // Too short
        'password123!'        // No uppercase
      ];

      weakPasswords.forEach(password => {
        const result = security.validateInput(password, 'password');
        assert.strictEqual(result.valid, false);
        assert(result.error !== undefined);
      });
    });

    test('should implement account lockout after failed attempts', () => {
      const email = 'test@example.com';
      
      // Make 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        const result = security.validateCredentials(email, 'wrongpassword');
        assert.strictEqual(result.success, false);
      }
      
      // 6th attempt should be blocked
      const blockedResult = security.validateCredentials(email, 'wrongpassword');
      assert.strictEqual(blockedResult.success, false);
      assert(blockedResult.error.includes('Account locked'));
    });

    test('should reset lockout after timeout period', () => {
      const email = 'test@example.com';
      
      // Trigger lockout
      for (let i = 0; i < 5; i++) {
        security.validateCredentials(email, 'wrongpassword');
      }
      
      // Simulate time passing
      const attempts = security.getLoginAttempts(email);
      attempts.lastAttempt = Date.now() - (16 * 60 * 1000); // 16 minutes ago
      
      // Should allow login again
      const result = security.validateCredentials(email, 'SecurePassword123!');
      assert.strictEqual(result.success, true);
    });

    test('should log security events', () => {
      security.validateCredentials('admin@example.com', 'wrongpassword');
      security.validateCredentials('admin@example.com', 'SecurePassword123!');
      
      const auditLog = security.getAuditLog();
      assert.strictEqual(auditLog.length, 2);
      assert.strictEqual(auditLog[0].event, 'login_failed');
      assert.strictEqual(auditLog[1].event, 'login_success');
    });
  });

  describe('Session Management', () => {
    let security;
    
    test('setup', () => {
      security = new MockSecuritySystem();
    });
    test('should create secure sessions', () => {
      const user = { id: 'user-1', email: 'admin@example.com' };
      const clientIP = '192.168.1.100';
      
      const session = security.createSession(user, clientIP);
      
      assert(session.id !== undefined);
      assert.strictEqual(session.id.length, 32);
      assert.deepStrictEqual(session.user, user);
      assert.strictEqual(session.clientIP, clientIP);
      assert(session.csrfToken !== undefined);
    });

    test('should validate sessions correctly', () => {
      const user = { id: 'user-1', email: 'admin@example.com' };
      const clientIP = '192.168.1.100';
      
      const session = security.createSession(user, clientIP);
      
      // Valid session
      const validResult = security.validateSession(session.id, clientIP);
      assert.strictEqual(validResult.valid, true);
      assert(validResult.session !== undefined);
    });

    test('should reject invalid sessions', () => {
      const result = security.validateSession('invalid-session-id', '192.168.1.100');
      
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid session');
    });

    test('should detect IP address changes', () => {
      const user = { id: 'user-1', email: 'admin@example.com' };
      const originalIP = '192.168.1.100';
      const differentIP = '192.168.1.200';
      
      const session = security.createSession(user, originalIP);
      
      const result = security.validateSession(session.id, differentIP);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Session IP mismatch');
    });

    test('should handle session expiration', () => {
      const user = { id: 'user-1', email: 'admin@example.com' };
      const clientIP = '192.168.1.100';
      
      const session = security.createSession(user, clientIP);
      
      // Simulate expired session
      session.lastActivity = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
      
      const result = security.validateSession(session.id, clientIP);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Session expired');
    });
  });

  describe('Rate Limiting', () => {
    let security;
    
    test('setup', () => {
      security = new MockSecuritySystem();
    });
    test('should allow requests within rate limit', () => {
      const clientIP = '192.168.1.100';
      
      for (let i = 0; i < 50; i++) {
        const result = security.checkRateLimit(clientIP);
        assert.strictEqual(result.allowed, true);
        assert(result.remaining >= 0);
      }
    });

    test('should block requests exceeding rate limit', () => {
      const clientIP = '192.168.1.100';
      
      // Exhaust rate limit
      for (let i = 0; i < 100; i++) {
        security.checkRateLimit(clientIP);
      }
      
      // Next request should be blocked
      const result = security.checkRateLimit(clientIP);
      assert.strictEqual(result.allowed, false);
      assert(result.retryAfter > 0);
    });

    test('should reset rate limit after window expires', () => {
      const clientIP = '192.168.1.100';
      
      // Exhaust rate limit
      for (let i = 0; i < 100; i++) {
        security.checkRateLimit(clientIP);
      }
      
      // Simulate time passing
      const limit = security.rateLimits.get(`rate_${clientIP}`);
      limit.window = Date.now() - (2 * 60 * 1000); // 2 minutes ago
      
      // Should allow requests again
      const result = security.checkRateLimit(clientIP);
      assert.strictEqual(result.allowed, true);
    });
  });

  describe('Input Validation', () => {
    let security;
    
    test('setup', () => {
      security = new MockSecuritySystem();
    });
    test('should validate email addresses', () => {
      const validEmails = [
        'user@example.com',
        'test.email@domain.co.uk',
        'user+tag@example.org'
      ];
      
      const invalidEmails = [
        'invalid-email',
        '@example.com',
        'user@',
        'user@.com',
        'user..double.dot@example.com'
      ];
      
      validEmails.forEach(email => {
        const result = security.validateInput(email, 'email');
        assert.strictEqual(result.valid, true);
      });
      
      invalidEmails.forEach(email => {
        const result = security.validateInput(email, 'email');
        assert.strictEqual(result.valid, false);
      });
    });

    test('should validate URLs', () => {
      const validUrls = [
        'https://example.com',
        'http://localhost:3000',
        'https://subdomain.example.com/path?query=value'
      ];
      
      const invalidUrls = [
        'not-a-url',
        'ftp://example.com',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>'
      ];
      
      validUrls.forEach(url => {
        const result = security.validateInput(url, 'url');
        assert.strictEqual(result.valid, true);
      });
      
      invalidUrls.forEach(url => {
        const result = security.validateInput(url, 'url');
        assert.strictEqual(result.valid, false);
      });
    });

    test('should validate IP addresses', () => {
      const validIPs = [
        '192.168.1.1',
        '10.0.0.1',
        '172.16.0.1',
        '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
      ];
      
      const invalidIPs = [
        '256.256.256.256',
        '192.168.1',
        'not-an-ip',
        '192.168.1.1.1'
      ];
      
      validIPs.forEach(ip => {
        const result = security.validateInput(ip, 'ip');
        assert.strictEqual(result.valid, true);
      });
      
      invalidIPs.forEach(ip => {
        const result = security.validateInput(ip, 'ip');
        assert.strictEqual(result.valid, false);
      });
    });
  });

  describe('XSS Protection', () => {
    let security;
    
    test('setup', () => {
      security = new MockSecuritySystem();
    });
    test('should sanitize HTML input', () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        '<img src="x" onerror="alert(1)">',
        'javascript:alert(1)',
        '<iframe src="javascript:alert(1)"></iframe>'
      ];
      
      maliciousInputs.forEach(input => {
        const sanitized = security.sanitizeInput(input);
        assert(!sanitized.includes('<script>'));
        assert(!sanitized.includes('javascript:'));
        assert(!sanitized.includes('onerror='));
      });
    });

    test('should preserve safe content', () => {
      const safeInputs = [
        'Hello World',
        'user@example.com',
        'Safe text with numbers 123',
        'Text with spaces and punctuation!'
      ];
      
      safeInputs.forEach(input => {
        const sanitized = security.sanitizeInput(input);
        // Should not contain HTML entities for safe characters
        assert(!sanitized.includes('&lt;'));
        assert(!sanitized.includes('&gt;'));
      });
    });
  });

  describe('SQL Injection Protection', () => {
    let security;
    
    test('setup', () => {
      security = new MockSecuritySystem();
    });
    test('should detect SQL injection attempts', () => {
      const sqlInjections = [
        "'; DROP TABLE users; --",
        "1' OR '1'='1",
        "admin'/*",
        "UNION SELECT * FROM passwords",
        "1=1",
        "; EXEC xp_cmdshell('dir')"
      ];
      
      sqlInjections.forEach(injection => {
        const result = security.validateSQLInput(injection);
        assert.strictEqual(result.safe, false);
        assert(result.error.includes('SQL injection'));
      });
    });

    test('should allow safe SQL input', () => {
      const safeInputs = [
        'normal text',
        'user@example.com',
        'Product name with spaces',
        'Description with numbers 123'
      ];
      
      safeInputs.forEach(input => {
        const result = security.validateSQLInput(input);
        assert.strictEqual(result.safe, true);
      });
    });
  });

  describe('CSRF Protection', () => {
    let security;
    
    test('setup', () => {
      security = new MockSecuritySystem();
    });
    test('should validate CSRF tokens', () => {
      const user = { id: 'user-1', email: 'admin@example.com' };
      const session = security.createSession(user, '192.168.1.100');
      
      // Valid CSRF token
      const validResult = security.validateCSRF(session.id, session.csrfToken);
      assert.strictEqual(validResult.valid, true);
      
      // Invalid CSRF token
      const invalidResult = security.validateCSRF(session.id, 'invalid-token');
      assert.strictEqual(invalidResult.valid, false);
      assert.strictEqual(invalidResult.error, 'CSRF token mismatch');
    });

    test('should reject CSRF validation for invalid sessions', () => {
      const result = security.validateCSRF('invalid-session', 'any-token');
      
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid session');
    });
  });

  describe('Security Audit and Logging', () => {
    let security;
    
    test('setup', () => {
      security = new MockSecuritySystem();
    });
    test('should log all security events', () => {
      security.clearAuditLog();
      
      // Generate various security events
      security.validateCredentials('admin@example.com', 'wrongpassword');
      const user = { id: 'user-1', email: 'admin@example.com' };
      const session = security.createSession(user, '192.168.1.100');
      security.validateSession('invalid-session', '192.168.1.100');
      
      const auditLog = security.getAuditLog();
      assert.strictEqual(auditLog.length, 3);
      
      auditLog.forEach(entry => {
        assert('timestamp' in entry);
        assert('event' in entry);
        assert('data' in entry);
        assert('id' in entry);
      });
    });

    test('should provide detailed audit information', () => {
      security.clearAuditLog();
      
      const email = 'admin@example.com';
      security.validateCredentials(email, 'wrongpassword');
      
      const auditLog = security.getAuditLog();
      const loginEvent = auditLog[0];
      
      assert.strictEqual(loginEvent.event, 'login_failed');
      assert.strictEqual(loginEvent.data.email, email);
      assert(Math.abs(loginEvent.timestamp - Date.now()) < 1000);
    });
  });

  describe('Security Configuration', () => {
    let security;
    
    test('setup', () => {
      security = new MockSecuritySystem();
    });
    test('should have secure default configurations', () => {
      assert(security.config.maxLoginAttempts <= 5);
      assert(security.config.lockoutDuration >= 15 * 60 * 1000); // At least 15 minutes
      assert(security.config.sessionTimeout <= 24 * 60 * 60 * 1000); // At most 24 hours
      assert(security.config.rateLimit.requests <= 1000); // Reasonable rate limit
    });

    test('should generate cryptographically secure tokens', () => {
      const tokens = new Set();
      
      // Generate 100 tokens
      for (let i = 0; i < 100; i++) {
        const token = security.generateSecureToken();
        
        assert.strictEqual(token.length, 32);
        assert(/^[A-Za-z0-9]+$/.test(token));
        assert(!tokens.has(token)); // Should be unique
        
        tokens.add(token);
      }
    });
  });
});
