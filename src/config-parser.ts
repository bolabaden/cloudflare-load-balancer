import { LoadBalancerConfig, ServiceConfig } from "./types";

/**
 * Matches a hostname against a regex pattern and extracts capture groups
 * Supports patterns like:
 * - ".*.example.com" matches "sub.example.com" and captures "sub"
 * - "api.(.+).example.com" matches "api.dev.example.com" and captures "dev"
 * - "(.+).sub.(.+).example.com" matches "app.sub.dev.example.com" and captures "app" and "dev"
 */
export function matchWildcard(pattern: string, hostname: string): string[] | null {
	try {
		const regex = new RegExp(`^${pattern}$`);
		const match = hostname.match(regex);
		
		if (match) {
			// Return capture groups (skip the full match at index 0)
			return match.slice(1);
		}
		return null;
	} catch (error) {
		// If regex is invalid, fall back to simple wildcard matching
		const regexPattern = pattern
			.replace(/\./g, '\\.') // Escape dots
			.replace(/\*/g, '[^.]+'); // Replace * with regex for non-dot characters
		
		const regex = new RegExp(`^${regexPattern}$`);
		return regex.test(hostname) ? [] : null;
	}
}

/**
 * Parses JSON configuration string into LoadBalancerConfig object
 */
export function parseConfig(configString: string): LoadBalancerConfig {
	try {
		const config = JSON.parse(configString) as LoadBalancerConfig;
		
		// Validate the configuration structure
		if (!config.services || !Array.isArray(config.services)) {
			throw new Error('Configuration must contain a "services" array');
		}
		
		// Validate each service
		for (const service of config.services) {
			if (!service.hostname || typeof service.hostname !== 'string') {
				throw new Error('Each service must have a "hostname" string');
			}
			if (!service.backends || !Array.isArray(service.backends)) {
				throw new Error('Each service must have a "backends" array');
			}
			if (service.backends.length === 0) {
				throw new Error('Each service must have at least one backend');
			}
			
			// Validate backend URLs
			for (const backend of service.backends) {
				if (typeof backend !== 'string') {
					throw new Error('Backends must be strings (URLs)');
				}
				try {
					new URL(backend);
				} catch {
					throw new Error(`Invalid backend URL: ${backend}`);
				}
			}
		}
		
		return config;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid JSON configuration: ${error.message}`);
		}
		throw error;
	}
}

/**
 * Finds the matching service configuration for a given hostname
 * Returns the first matching service or null if no match found
 */
export function findMatchingService(hostname: string, config: LoadBalancerConfig): ServiceConfig | null {
	for (const service of config.services) {
		if (matchWildcard(service.hostname, hostname) !== null) {
			return service;
		}
	}
	return null;
}

/**
 * Expands regex backends for a given hostname using capture groups
 * Replaces $1, $2, etc. in backend URLs with captured groups from the hostname
 */
export function expandWildcardBackends(hostname: string, backends: string[], pattern: string): string[] {
	console.log('expandWildcardBackends called with:', { hostname, backends, pattern });
	
	// Get capture groups from the hostname pattern
	const captureGroups = matchWildcard(pattern, hostname);
	
	console.log('Capture groups extracted:', captureGroups);
	
	if (!captureGroups) {
		throw new Error(`Hostname ${hostname} does not match pattern ${pattern}`);
	}
	
	return backends.map(backend => {
		console.log('Processing backend:', backend);
		
		if (!backend.includes('$')) {
			console.log('No placeholders found, returning as-is:', backend);
			return backend;
		}
		
		// Replace $1, $2, etc. with captured groups in the entire URL string
		let expandedBackend = backend;
		captureGroups.forEach((group, index) => {
			const placeholder = `$${index + 1}`;
			const before = expandedBackend;
			expandedBackend = expandedBackend.replace(new RegExp(`\\${placeholder}`, 'g'), group);
			console.log(`Replaced ${placeholder} with "${group}": ${before} -> ${expandedBackend}`);
		});
		
		// Validate the expanded URL
		try {
			new URL(expandedBackend);
			console.log('Final expanded backend:', expandedBackend);
			return expandedBackend;
		} catch (error) {
			throw new Error(`Invalid expanded backend URL: ${expandedBackend} (original: ${backend})`);
		}
	});
}

/**
 * Legacy parser for backward compatibility with pipe-separated format
 */
export function parseLegacyConfig(configString: string): LoadBalancerConfig {
	const services: ServiceConfig[] = [];
	const entries = configString.split(',');
	
	for (const entry of entries) {
		const [hostname, ...urls] = entry.split('|');
		if (hostname && urls.length > 0) {
			services.push({
				hostname: hostname.trim(),
				backends: urls.map(url => url.trim())
			});
		}
	}
	
	return { services };
}

/**
 * Determines if a configuration string is in JSON format
 */
export function isJsonConfig(configString: string): boolean {
	try {
		const parsed = JSON.parse(configString);
		return typeof parsed === 'object' && parsed !== null && 'services' in parsed;
	} catch {
		return false;
	}
}

/**
 * Main configuration parser that handles both JSON and legacy formats
 */
export function parseConfiguration(configString: string): LoadBalancerConfig {
	if (!isJsonConfig(configString)) {
		throw new Error('Invalid JSON configuration');
	}
	return parseConfig(configString);
} 