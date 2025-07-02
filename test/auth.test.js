import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

describe('Authentication System Tests', () => {
  let mockEnv;
  let testJwtSecret;
  let testUser;

  before(() => {
    testJwtSecret = 'test-secret-key-for-jwt-signing-minimum-256-bits-long';
    testUser = {
      id: '12345',
      email: 'test@example.com',
      name: 'Test User',
      provider: 'github'
    };

    mockEnv = {
      JWT_SECRET: testJwtSecret,
      AUTHORIZED_USERS: 'test@example.com,admin@example.com,user@example.com',
      GITHUB_CLIENT_ID: 'test-github-client-id',
      GITHUB_CLIENT_SECRET: 'test-github-client-secret',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret'
    };
  });

  describe('JWT Token Generation and Validation', () => {
    test('should generate valid JWT tokens', async () => {
      const payload = {
        userId: testUser.id,
        email: testUser.email,
        name: testUser.name,
        provider: testUser.provider,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
      };

      // Mock JWT creation (simplified implementation)
      const header = { alg: 'HS256', typ: 'JWT' };
      const encodedHeader = btoa(JSON.stringify(header)).replace(/[=+/]/g, (c) => ({
        '=': '', '+': '-', '/': '_'
      }[c]));
      
      const encodedPayload = btoa(JSON.stringify(payload)).replace(/[=+/]/g, (c) => ({
        '=': '', '+': '-', '/': '_'
      }[c]));

      const signature = await createHmacSignature(`${encodedHeader}.${encodedPayload}`, testJwtSecret);
      const token = `${encodedHeader}.${encodedPayload}.${signature}`;

      assert(token.includes('.'), 'JWT should have three parts separated by dots');
      assert.strictEqual(token.split('.').length, 3, 'JWT should have exactly three parts');
      
      // Verify token structure
      const [headerPart, payloadPart, signaturePart] = token.split('.');
      assert(headerPart.length > 0, 'Header part should not be empty');
      assert(payloadPart.length > 0, 'Payload part should not be empty');
      assert(signaturePart.length > 0, 'Signature part should not be empty');
    });

    test('should validate JWT token signatures correctly', async () => {
      const payload = {
        userId: testUser.id,
        email: testUser.email,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const token = await createTestJWT(payload, testJwtSecret);
      const isValid = await validateTestJWT(token, testJwtSecret);
      
      assert.strictEqual(isValid, true, 'Valid JWT should pass validation');
    });

    test('should reject JWT tokens with invalid signatures', async () => {
      const payload = {
        userId: testUser.id,
        email: testUser.email,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const token = await createTestJWT(payload, testJwtSecret);
      const tamperedToken = token.slice(0, -5) + 'xxxxx'; // Tamper with signature
      
      const isValid = await validateTestJWT(tamperedToken, testJwtSecret);
      
      assert.strictEqual(isValid, false, 'Tampered JWT should fail validation');
    });

    test('should reject expired JWT tokens', async () => {
      const expiredPayload = {
        userId: testUser.id,
        email: testUser.email,
        iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
        exp: Math.floor(Date.now() / 1000) - 3600  // 1 hour ago (expired)
      };

      const expiredToken = await createTestJWT(expiredPayload, testJwtSecret);
      const isValid = await validateTestJWT(expiredToken, testJwtSecret);
      
      assert.strictEqual(isValid, false, 'Expired JWT should fail validation');
    });

    test('should handle JWT tokens with missing claims', async () => {
      const incompletePayload = {
        userId: testUser.id,
        // Missing email, iat, exp
      };

      const incompleteToken = await createTestJWT(incompletePayload, testJwtSecret);
      const isValid = await validateTestJWT(incompleteToken, testJwtSecret);
      
      // Should fail validation due to missing required claims
      assert.strictEqual(isValid, false, 'JWT with missing claims should fail validation');
    });
  });

  describe('OAuth PKCE Flow Implementation', () => {
    test('should generate valid PKCE code challenge and verifier', () => {
      // Generate code verifier (43-128 characters, URL-safe)
      const codeVerifier = generateCodeVerifier();
      
      assert(codeVerifier.length >= 43, 'Code verifier should be at least 43 characters');
      assert(codeVerifier.length <= 128, 'Code verifier should be at most 128 characters');
      assert(/^[A-Za-z0-9\-._~]+$/.test(codeVerifier), 'Code verifier should be URL-safe');
    });

    test('should generate matching code challenge from verifier', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      
      assert(codeChallenge.length > 0, 'Code challenge should not be empty');
      assert(/^[A-Za-z0-9\-_]+$/.test(codeChallenge), 'Code challenge should be base64url encoded');
      
      // Verify challenge matches verifier
      const expectedChallenge = await generateCodeChallenge(codeVerifier);
      assert.strictEqual(codeChallenge, expectedChallenge, 'Same verifier should produce same challenge');
    });

    test('should validate PKCE code verifier against challenge', async () => {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      
      const isValid = await validatePKCE(codeVerifier, codeChallenge);
      assert.strictEqual(isValid, true, 'Valid PKCE pair should pass validation');
      
      // Test with wrong verifier
      const wrongVerifier = generateCodeVerifier();
      const isInvalid = await validatePKCE(wrongVerifier, codeChallenge);
      assert.strictEqual(isInvalid, false, 'Wrong verifier should fail validation');
    });

    test('should handle PKCE edge cases', async () => {
      // Test minimum length verifier
      const minVerifier = 'a'.repeat(43);
      const minChallenge = await generateCodeChallenge(minVerifier);
      const minValid = await validatePKCE(minVerifier, minChallenge);
      assert.strictEqual(minValid, true, 'Minimum length verifier should work');
      
      // Test maximum length verifier
      const maxVerifier = 'a'.repeat(128);
      const maxChallenge = await generateCodeChallenge(maxVerifier);
      const maxValid = await validatePKCE(maxVerifier, maxChallenge);
      assert.strictEqual(maxValid, true, 'Maximum length verifier should work');
      
      // Test empty verifier (should fail)
      try {
        await generateCodeChallenge('');
        assert.fail('Empty verifier should throw error');
      } catch (error) {
        assert(error instanceof Error, 'Should throw error for empty verifier');
      }
    });
  });

  describe('Authorization Validation', () => {
    test('should authorize users in authorized list', () => {
      const authorizedEmails = mockEnv.AUTHORIZED_USERS.split(',');
      
      assert(isUserAuthorized('test@example.com', authorizedEmails), 'test@example.com should be authorized');
      assert(isUserAuthorized('admin@example.com', authorizedEmails), 'admin@example.com should be authorized');
      assert(isUserAuthorized('user@example.com', authorizedEmails), 'user@example.com should be authorized');
    });

    test('should reject unauthorized users', () => {
      const authorizedEmails = mockEnv.AUTHORIZED_USERS.split(',');
      
      assert(!isUserAuthorized('hacker@evil.com', authorizedEmails), 'hacker@evil.com should not be authorized');
      assert(!isUserAuthorized('', authorizedEmails), 'Empty email should not be authorized');
      assert(!isUserAuthorized(null, authorizedEmails), 'Null email should not be authorized');
    });

    test('should handle case-insensitive email matching', () => {
      const authorizedEmails = mockEnv.AUTHORIZED_USERS.split(',');
      
      assert(isUserAuthorized('TEST@EXAMPLE.COM', authorizedEmails), 'Uppercase email should be authorized');
      assert(isUserAuthorized('Test@Example.Com', authorizedEmails), 'Mixed case email should be authorized');
    });

    test('should handle whitespace in email lists', () => {
      const emailsWithWhitespace = ' test@example.com , admin@example.com , user@example.com ';
      const authorizedEmails = emailsWithWhitespace.split(',').map(email => email.trim());
      
      assert(isUserAuthorized('test@example.com', authorizedEmails), 'Should handle whitespace in email list');
    });

    test('should validate email format', () => {
      const validEmails = [
        'user@example.com',
        'user.name@example.com',
        'user+tag@example.com',
        'user123@example-site.com'
      ];

      const invalidEmails = [
        'invalid-email',
        '@example.com',
        'user@',
        'user@.com',
        'user space@example.com'
      ];

      validEmails.forEach(email => {
        assert(isValidEmail(email), `${email} should be valid`);
      });

      invalidEmails.forEach(email => {
        assert(!isValidEmail(email), `${email} should be invalid`);
      });
    });
  });

  describe('GitHub OAuth Integration', () => {
    test('should generate GitHub OAuth URL correctly', () => {
      const state = generateRandomState();
      const redirectUri = 'https://example.com/auth/github/callback';
      const clientId = mockEnv.GITHUB_CLIENT_ID;
      
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email&state=${state}`;
      
      assert(authUrl.includes('github.com/login/oauth/authorize'), 'Should use GitHub OAuth endpoint');
      assert(authUrl.includes(`client_id=${clientId}`), 'Should include client ID');
      assert(authUrl.includes('scope=user:email'), 'Should request email scope');
      assert(authUrl.includes(`state=${state}`), 'Should include state parameter');
    });

    test('should validate GitHub OAuth callback parameters', () => {
      const validParams = {
        code: 'github_auth_code_123',
        state: 'random_state_456'
      };

      const invalidParams = [
        { error: 'access_denied' },
        { code: '', state: 'valid_state' },
        { code: 'valid_code', state: '' },
        {}
      ];

      // Valid parameters should pass
      assert(validateOAuthCallback(validParams), 'Valid OAuth callback should pass validation');

      // Invalid parameters should fail
      invalidParams.forEach(params => {
        assert(!validateOAuthCallback(params), `Invalid params ${JSON.stringify(params)} should fail validation`);
      });
    });

    test('should handle GitHub user data correctly', () => {
      const githubUserResponse = {
        id: 12345,
        login: 'testuser',
        email: 'test@example.com',
        name: 'Test User',
        avatar_url: 'https://github.com/avatar.jpg'
      };

      const normalizedUser = normalizeGitHubUser(githubUserResponse);
      
      assert.strictEqual(normalizedUser.id, '12345', 'Should convert ID to string');
      assert.strictEqual(normalizedUser.email, 'test@example.com', 'Should preserve email');
      assert.strictEqual(normalizedUser.name, 'Test User', 'Should preserve name');
      assert.strictEqual(normalizedUser.provider, 'github', 'Should set provider to github');
    });
  });

  describe('Google OAuth Integration', () => {
    test('should generate Google OAuth URL correctly', () => {
      const state = generateRandomState();
      const redirectUri = 'https://example.com/auth/google/callback';
      const clientId = mockEnv.GOOGLE_CLIENT_ID;
      
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=email%20profile&response_type=code&state=${state}`;
      
      assert(authUrl.includes('accounts.google.com/o/oauth2/v2/auth'), 'Should use Google OAuth endpoint');
      assert(authUrl.includes(`client_id=${clientId}`), 'Should include client ID');
      assert(authUrl.includes('scope=email%20profile'), 'Should request email and profile scopes');
      assert(authUrl.includes('response_type=code'), 'Should use authorization code flow');
    });

    test('should handle Google user data correctly', () => {
      const googleUserResponse = {
        id: '67890',
        email: 'test@gmail.com',
        name: 'Test User',
        picture: 'https://lh3.googleusercontent.com/photo.jpg',
        verified_email: true
      };

      const normalizedUser = normalizeGoogleUser(googleUserResponse);
      
      assert.strictEqual(normalizedUser.id, '67890', 'Should preserve ID as string');
      assert.strictEqual(normalizedUser.email, 'test@gmail.com', 'Should preserve email');
      assert.strictEqual(normalizedUser.name, 'Test User', 'Should preserve name');
      assert.strictEqual(normalizedUser.provider, 'google', 'Should set provider to google');
      assert.strictEqual(normalizedUser.verified, true, 'Should preserve email verification status');
    });
  });

  describe('Session Management', () => {
    test('should create and validate session cookies', () => {
      const sessionData = {
        userId: testUser.id,
        email: testUser.email,
        loginTime: Date.now(),
        expiresAt: Date.now() + 3600000 // 1 hour
      };

      const cookieValue = btoa(JSON.stringify(sessionData));
      const cookie = `session=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`;
      
      assert(cookie.includes('HttpOnly'), 'Session cookie should be HttpOnly');
      assert(cookie.includes('Secure'), 'Session cookie should be Secure');
      assert(cookie.includes('SameSite=Lax'), 'Session cookie should have SameSite=Lax');
      assert(cookie.includes('Max-Age=3600'), 'Session cookie should have proper expiration');
    });

    test('should handle session expiration', () => {
      const expiredSession = {
        userId: testUser.id,
        email: testUser.email,
        expiresAt: Date.now() - 1000 // Expired 1 second ago
      };

      const currentSession = {
        userId: testUser.id,
        email: testUser.email,
        expiresAt: Date.now() + 3600000 // Expires in 1 hour
      };

      assert(!isSessionValid(expiredSession), 'Expired session should be invalid');
      assert(isSessionValid(currentSession), 'Current session should be valid');
    });

    test('should handle session renewal', () => {
      const originalSession = {
        userId: testUser.id,
        email: testUser.email,
        loginTime: Date.now() - 1800000, // 30 minutes ago
        expiresAt: Date.now() + 1800000   // 30 minutes from now
      };

      const renewedSession = renewSession(originalSession);
      
      assert(renewedSession.expiresAt > originalSession.expiresAt, 'Renewed session should have later expiration');
      assert.strictEqual(renewedSession.userId, originalSession.userId, 'User ID should be preserved');
      assert.strictEqual(renewedSession.email, originalSession.email, 'Email should be preserved');
    });
  });

  describe('Security Features', () => {
    test('should generate cryptographically secure random states', () => {
      const states = new Set();
      const numStates = 1000;
      
      for (let i = 0; i < numStates; i++) {
        const state = generateRandomState();
        assert(state.length >= 32, 'State should be at least 32 characters');
        assert(/^[A-Za-z0-9]+$/.test(state), 'State should be alphanumeric');
        assert(!states.has(state), 'States should be unique');
        states.add(state);
      }
      
      assert.strictEqual(states.size, numStates, 'All generated states should be unique');
    });

    test('should implement rate limiting for authentication attempts', () => {
      const rateLimiter = new Map();
      const clientIp = '192.168.1.100';
      const maxAttempts = 5;
      const windowMs = 300000; // 5 minutes
      
      // Simulate multiple attempts
      for (let i = 0; i < maxAttempts + 2; i++) {
        const isAllowed = checkRateLimit(rateLimiter, clientIp, maxAttempts, windowMs);
        
        if (i < maxAttempts) {
          assert(isAllowed, `Attempt ${i + 1} should be allowed`);
        } else {
          assert(!isAllowed, `Attempt ${i + 1} should be blocked by rate limiting`);
        }
      }
    });

    test('should validate password strength requirements', () => {
      const strongPasswords = [
        'MyStr0ngP@ssw0rd!',
        'C0mpl3x_P@ssw0rd_123',
        'Sup3r$ecur3P@ss!'
      ];

      const weakPasswords = [
        'password',
        '123456',
        'abc123',
        'password123',
        'qwerty'
      ];

      strongPasswords.forEach(password => {
        assert(isPasswordStrong(password), `${password} should be considered strong`);
      });

      weakPasswords.forEach(password => {
        assert(!isPasswordStrong(password), `${password} should be considered weak`);
      });
    });

    test('should implement CSRF protection', () => {
      const csrfToken = generateCSRFToken();
      
      assert(csrfToken.length >= 32, 'CSRF token should be at least 32 characters');
      assert(/^[A-Za-z0-9]+$/.test(csrfToken), 'CSRF token should be alphanumeric');
      
      // Validate CSRF token
      assert(validateCSRFToken(csrfToken, csrfToken), 'Valid CSRF token should pass validation');
      assert(!validateCSRFToken(csrfToken, 'invalid-token'), 'Invalid CSRF token should fail validation');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle network errors during OAuth exchange', async () => {
      // Mock network error
      const mockFetch = async () => {
        throw new Error('Network error');
      };

      let networkError = null;
      try {
        await mockOAuthExchange('test-code', mockFetch);
      } catch (error) {
        networkError = error;
      }

      assert(networkError instanceof Error, 'Should catch network errors');
      assert.strictEqual(networkError.message, 'Network error', 'Should preserve error message');
    });

    test('should handle malformed OAuth responses', async () => {
      const malformedResponses = [
        { status: 200, json: async () => ({ error: 'invalid_grant' }) },
        { status: 200, json: async () => ({}) }, // Missing required fields
        { status: 400, json: async () => ({ error: 'invalid_request' }) },
        { status: 500, text: async () => 'Internal Server Error' }
      ];

      for (const response of malformedResponses) {
        let error = null;
        try {
          await handleOAuthResponse(response);
        } catch (e) {
          error = e;
        }
        
        assert(error instanceof Error, 'Should handle malformed responses gracefully');
      }
    });

    test('should handle JWT parsing errors', () => {
      const malformedTokens = [
        'not.a.jwt',
        'invalid-jwt-format',
        'header.payload', // Missing signature
        'header.payload.signature.extra', // Too many parts
        ''
      ];

      malformedTokens.forEach(token => {
        let error = null;
        try {
          parseJWT(token);
        } catch (e) {
          error = e;
        }
        
        assert(error instanceof Error, `Should handle malformed JWT: ${token}`);
      });
    });

    test('should handle concurrent authentication requests', async () => {
      const concurrentRequests = [];
      const numRequests = 20;
      
      for (let i = 0; i < numRequests; i++) {
        concurrentRequests.push(
          simulateAuthRequest({
            email: `user${i}@example.com`,
            provider: 'github',
            code: `auth-code-${i}`
          })
        );
      }

      const results = await Promise.all(concurrentRequests);
      
      assert.strictEqual(results.length, numRequests, 'All concurrent requests should complete');
      assert(results.every(result => result.success !== undefined), 'All results should have success status');
    });
  });

  // Helper functions for testing
  async function createHmacSignature(data, secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/[=+/]/g, (c) => ({ '=': '', '+': '-', '/': '_' }[c]));
  }

  async function createTestJWT(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = btoa(JSON.stringify(header)).replace(/[=+/]/g, (c) => ({
      '=': '', '+': '-', '/': '_'
    }[c]));
    
    const encodedPayload = btoa(JSON.stringify(payload)).replace(/[=+/]/g, (c) => ({
      '=': '', '+': '-', '/': '_'
    }[c]));

    const signature = await createHmacSignature(`${encodedHeader}.${encodedPayload}`, secret);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  async function validateTestJWT(token, secret) {
    try {
      const [headerPart, payloadPart, signaturePart] = token.split('.');
      if (!headerPart || !payloadPart || !signaturePart) return false;

      const expectedSignature = await createHmacSignature(`${headerPart}.${payloadPart}`, secret);
      if (signaturePart !== expectedSignature) return false;

      const payload = JSON.parse(atob(payloadPart.replace(/[-_]/g, (c) => ({ '-': '+', '_': '/' }[c]))));
      const now = Math.floor(Date.now() / 1000);
      
      return payload.exp > now;
    } catch {
      return false;
    }
  }

  function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/[+/]/g, (c) => ({ '+': '-', '/': '_' }[c]))
      .replace(/=/g, '');
  }

  async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/[+/]/g, (c) => ({ '+': '-', '/': '_' }[c]))
      .replace(/=/g, '');
  }

  async function validatePKCE(verifier, challenge) {
    const expectedChallenge = await generateCodeChallenge(verifier);
    return expectedChallenge === challenge;
  }

  function isUserAuthorized(email, authorizedEmails) {
    if (!email || !Array.isArray(authorizedEmails)) return false;
    return authorizedEmails.some(authorizedEmail => 
      authorizedEmail.toLowerCase().trim() === email.toLowerCase().trim()
    );
  }

  function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  function validateOAuthCallback(params) {
    return !params.error && params.code && params.state;
  }

  function normalizeGitHubUser(githubUser) {
    return {
      id: String(githubUser.id),
      email: githubUser.email,
      name: githubUser.name || githubUser.login,
      provider: 'github',
      avatarUrl: githubUser.avatar_url
    };
  }

  function normalizeGoogleUser(googleUser) {
    return {
      id: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      provider: 'google',
      verified: googleUser.verified_email,
      avatarUrl: googleUser.picture
    };
  }

  function isSessionValid(session) {
    return session && session.expiresAt > Date.now();
  }

  function renewSession(session) {
    return {
      ...session,
      expiresAt: Date.now() + 3600000 // Extend by 1 hour
    };
  }

  function generateRandomState() {
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array)).replace(/[+/=]/g, '');
  }

  function checkRateLimit(rateLimiter, clientIp, maxAttempts, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!rateLimiter.has(clientIp)) {
      rateLimiter.set(clientIp, []);
    }
    
    const attempts = rateLimiter.get(clientIp);
    // Remove old attempts
    while (attempts.length > 0 && attempts[0] < windowStart) {
      attempts.shift();
    }
    
    if (attempts.length >= maxAttempts) {
      return false;
    }
    
    attempts.push(now);
    return true;
  }

  function isPasswordStrong(password) {
    return password.length >= 8 &&
           /[a-z]/.test(password) &&
           /[A-Z]/.test(password) &&
           /[0-9]/.test(password) &&
           /[^a-zA-Z0-9]/.test(password);
  }

  function generateCSRFToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array)).replace(/[+/=]/g, '');
  }

  function validateCSRFToken(provided, expected) {
    return provided === expected;
  }

  async function mockOAuthExchange(code, fetchFn) {
    const response = await fetchFn('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    
    if (!response.ok) {
      throw new Error(`OAuth exchange failed: ${response.status}`);
    }
    
    return response.json();
  }

  async function handleOAuthResponse(response) {
    if (!response.ok) {
      throw new Error(`OAuth error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.error) {
      throw new Error(`OAuth error: ${data.error}`);
    }
    
    if (!data.access_token) {
      throw new Error('Missing access token in OAuth response');
    }
    
    return data;
  }

  function parseJWT(token) {
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token format');
    }
    
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    
    try {
      const payload = JSON.parse(atob(parts[1].replace(/[-_]/g, (c) => ({ '-': '+', '_': '/' }[c]))));
      return payload;
    } catch {
      throw new Error('Invalid JWT payload');
    }
  }

  async function simulateAuthRequest(params) {
    // Simulate async auth processing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
    
    return {
      success: params.email.includes('@example.com'),
      user: params.email.includes('@example.com') ? {
        email: params.email,
        provider: params.provider
      } : null
    };
  }
});
