import { describe, it, expect } from 'vitest';

// Simple implementations for testing (mirroring the TypeScript functions)
function matchesWildcard(hostname, pattern) {
  // If no wildcard, do exact match
  if (!pattern.includes('*')) {
    return hostname === pattern;
  }
  
  // Convert wildcard pattern to regex
  // First replace * with a placeholder to avoid escaping issues
  const placeholder = '___WILDCARD_PLACEHOLDER___';
  const patternWithPlaceholder = pattern.replace(/\*/g, placeholder);
  
  // Escape special regex characters except our placeholder
  const escapedPattern = patternWithPlaceholder.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  
  // Replace placeholder with regex wildcard pattern
  const regexPattern = escapedPattern.replace(new RegExp(placeholder, 'g'), '.*');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(hostname);
}

function parseDefaultBackends(defaultBackends) {
  if (!defaultBackends) return [];
  
  try {
    const config = JSON.parse(defaultBackends);
    
    // Support both array format and object format
    if (Array.isArray(config)) {
      // Direct array format: [{"hostname": "...", "backends": [...]}]
      return config.filter((service) => 
        service.hostname && 
        Array.isArray(service.backends) && 
        service.backends.length > 0
      );
    } else if (config.services && Array.isArray(config.services)) {
      // Object format: {"services": [{"hostname": "...", "backends": [...]}]}
      return config.services.filter((service) => 
        service.hostname && 
        Array.isArray(service.backends) && 
        service.backends.length > 0
      );
    } else if (config.hostname && Array.isArray(config.backends)) {
      // Single service format: {"hostname": "...", "backends": [...]}
      return [config];
    }
    
    return [];
  } catch (error) {
    console.error('Failed to parse DEFAULT_BACKENDS JSON:', error);
    return [];
  }
}

function findMatchingService(hostname, services) {
  // First try exact matches
  for (const service of services) {
    if (service.hostname === hostname) {
      return service;
    }
  }
  
  // Then try wildcard matches
  for (const service of services) {
    if (matchesWildcard(hostname, service.hostname)) {
      return service;
    }
  }
  
  return null;
}

function resolveServiceHostname(requestHostname, defaultBackends) {
  const services = parseDefaultBackends(defaultBackends);
  const matchingService = findMatchingService(requestHostname, services);
  
  if (matchingService) {
    // Return the configured service hostname (which may be a wildcard pattern)
    // This ensures all requests matching a wildcard pattern use the same DO instance
    return matchingService.hostname;
  }
  
  // No match found, use the original hostname
  return requestHostname;
}

describe('Wildcard Hostname Matching', () => {
  describe('matchesWildcard', () => {
    it('should match exact hostnames', () => {
      expect(matchesWildcard('aiostreams.bolabaden.org', 'aiostreams.bolabaden.org')).toBe(true);
      expect(matchesWildcard('aiostreams.bolabaden.org', 'different.bolabaden.org')).toBe(false);
    });

    it('should match wildcard patterns', () => {
      expect(matchesWildcard('test.bolabaden.org', '*.bolabaden.org')).toBe(true);
      expect(matchesWildcard('micklethefickle.bolabaden.org', '*.bolabaden.org')).toBe(true);
      expect(matchesWildcard('beatapostapita.bolabaden.org', '*.bolabaden.org')).toBe(true);
      expect(matchesWildcard('vractormania.bolabaden.org', '*.bolabaden.org')).toBe(true);
    });

    it('should not match wildcard patterns incorrectly', () => {
      expect(matchesWildcard('test.different.org', '*.bolabaden.org')).toBe(false);
      expect(matchesWildcard('bolabaden.org', '*.bolabaden.org')).toBe(false);
      expect(matchesWildcard('sub.test.bolabaden.org', '*.bolabaden.org')).toBe(false);
    });

    it('should handle multiple wildcards', () => {
      expect(matchesWildcard('test.example.com', '*.*.com')).toBe(true);
      expect(matchesWildcard('a.b.c.d.com', '*.*.com')).toBe(true);
      expect(matchesWildcard('single.com', '*.*.com')).toBe(true);
    });

    it('should handle wildcards at the beginning', () => {
      expect(matchesWildcard('prefix-test.bolabaden.org', '*test.bolabaden.org')).toBe(true);
      expect(matchesWildcard('test.bolabaden.org', '*test.bolabaden.org')).toBe(true);
      expect(matchesWildcard('different.bolabaden.org', '*test.bolabaden.org')).toBe(false);
    });

    it('should handle wildcards in the middle', () => {
      expect(matchesWildcard('api.v1.bolabaden.org', 'api.*.bolabaden.org')).toBe(true);
      expect(matchesWildcard('api.v2.bolabaden.org', 'api.*.bolabaden.org')).toBe(true);
      expect(matchesWildcard('web.v1.bolabaden.org', 'api.*.bolabaden.org')).toBe(false);
    });
  });

  describe('findMatchingService', () => {
    const services = [
      { hostname: 'aiostreams.bolabaden.org', backends: ['https://backend1.com'] },
      { hostname: '*.bolabaden.org', backends: ['https://wildcard1.com', 'https://wildcard2.com'] },
      { hostname: 'api.*.example.com', backends: ['https://api1.com'] },
      { hostname: 'specific.example.com', backends: ['https://specific1.com'] }
    ];

    it('should prefer exact matches over wildcards', () => {
      const result = findMatchingService('aiostreams.bolabaden.org', services);
      expect(result).toEqual({
        hostname: 'aiostreams.bolabaden.org',
        backends: ['https://backend1.com']
      });
    });

    it('should fall back to wildcard matches', () => {
      const result = findMatchingService('test.bolabaden.org', services);
      expect(result).toEqual({
        hostname: '*.bolabaden.org',
        backends: ['https://wildcard1.com', 'https://wildcard2.com']
      });
    });

    it('should match complex wildcard patterns', () => {
      const result = findMatchingService('api.v1.example.com', services);
      expect(result).toEqual({
        hostname: 'api.*.example.com',
        backends: ['https://api1.com']
      });
    });

    it('should return null for no matches', () => {
      const result = findMatchingService('nomatch.different.org', services);
      expect(result).toBe(null);
    });
  });

  describe('resolveServiceHostname', () => {
    const defaultBackends = JSON.stringify({
      services: [
        { hostname: 'aiostreams.bolabaden.org', backends: ['https://backend1.com'] },
        { hostname: '*.bolabaden.org', backends: ['https://wildcard1.com', 'https://wildcard2.com'] },
        { hostname: 'api.*.example.com', backends: ['https://api1.com'] }
      ]
    });

    it('should resolve exact matches to themselves', () => {
      const result = resolveServiceHostname('aiostreams.bolabaden.org', defaultBackends);
      expect(result).toBe('aiostreams.bolabaden.org');
    });

    it('should resolve wildcard matches to the wildcard pattern', () => {
      const result = resolveServiceHostname('test.bolabaden.org', defaultBackends);
      expect(result).toBe('*.bolabaden.org');
    });

    it('should resolve complex wildcard matches', () => {
      const result = resolveServiceHostname('api.v1.example.com', defaultBackends);
      expect(result).toBe('api.*.example.com');
    });

    it('should return original hostname for no matches', () => {
      const result = resolveServiceHostname('nomatch.different.org', defaultBackends);
      expect(result).toBe('nomatch.different.org');
    });

    it('should handle empty or invalid configuration', () => {
      expect(resolveServiceHostname('test.com', '')).toBe('test.com');
      expect(resolveServiceHostname('test.com', 'invalid json')).toBe('test.com');
    });
  });

  describe('Integration test scenarios', () => {
    it('should handle the user example correctly', () => {
      // User's example: *.micklethefickle.bolabaden.org, *beatapostapita.bolabaden.org, *vractormania.bolabaden.org
      // should resolve to *.bolabaden.org
      const config = JSON.stringify({
        services: [
          { hostname: '*.bolabaden.org', backends: ['https://backend1.com', 'https://backend2.com'] }
        ]
      });

      expect(resolveServiceHostname('anythinkg.micklethefickle.bolabaden.org', config)).toBe('*.bolabaden.org');
      expect(resolveServiceHostname('somethingbeatapostapita.bolabaden.org', config)).toBe('*.bolabaden.org');
      expect(resolveServiceHostname('whatevervractormania.bolabaden.org', config)).toBe('*.bolabaden.org');
    });
  });
}); 