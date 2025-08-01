export interface LogContext {
	serviceId?: string;
	backendId?: string;
	requestId?: string;
	clientIp?: string;
	userAgent?: string;
	url?: string;
	method?: string;
	statusCode?: number;
	duration?: number;
	error?: Error | string;
	[key: string]: any;
}

export interface LogLevel {
	level: 'debug' | 'info' | 'warn' | 'error';
	priority: number;
}

export const LOG_LEVELS: Record<string, LogLevel> = {
	debug: { level: 'debug', priority: 0 },
	info: { level: 'info', priority: 1 },
	warn: { level: 'warn', priority: 2 },
	error: { level: 'error', priority: 3 }
};

export class Logger {
	private isDebugMode: boolean;
	private serviceId: string;

	constructor(env: Env, serviceId: string = 'global') {
		this.isDebugMode = env.DEBUG === 'true';
		this.serviceId = serviceId;
	}

	/**
	 * Debug level logging - only shown when DEBUG=true
	 */
	debug(message: string, context: LogContext = {}): void {
		if (this.isDebugMode) {
			this.log('debug', message, context);
		}
	}

	/**
	 * Info level logging - always shown
	 */
	info(message: string, context: LogContext = {}): void {
		this.log('info', message, context);
	}

	/**
	 * Warning level logging - always shown
	 */
	warn(message: string, context: LogContext = {}): void {
		this.log('warn', message, context);
	}

	/**
	 * Error level logging - always shown
	 */
	error(message: string, context: LogContext = {}): void {
		this.log('error', message, context);
	}

	/**
	 * Log request details - comprehensive when DEBUG=true, minimal otherwise
	 */
	logRequest(request: Request, context: LogContext = {}): void {
		const url = new URL(request.url);
		const clientIp = this.getClientIp(request);
		const userAgent = request.headers.get('user-agent') || 'unknown';
		
		const baseContext: LogContext = {
			...context,
			url: url.toString(),
			method: request.method,
			clientIp,
			userAgent,
			hostname: url.hostname,
			pathname: url.pathname,
			query: url.search,
			headers: this.isDebugMode ? Object.fromEntries(request.headers.entries()) : undefined
		};

		if (this.isDebugMode) {
			this.debug('Request received', baseContext);
		} else {
			this.info(`Request: ${request.method} ${url.pathname}`, {
				clientIp,
				hostname: url.hostname
			});
		}
	}

	/**
	 * Log response details
	 */
	logResponse(response: Response, duration: number, context: LogContext = {}): void {
		const responseContext: LogContext = {
			...context,
			statusCode: response.status,
			statusText: response.statusText,
			duration,
			headers: this.isDebugMode ? Object.fromEntries(response.headers.entries()) : undefined
		};

		if (this.isDebugMode) {
			this.debug('Response sent', responseContext);
		} else {
			this.info(`Response: ${response.status} ${response.statusText} (${duration}ms)`, {
				statusCode: response.status,
				duration
			});
		}
	}

	/**
	 * Log backend selection
	 */
	logBackendSelection(backend: any, algorithm: string, context: LogContext = {}): void {
		const selectionContext: LogContext = {
			...context,
			backendId: backend.id,
			backendUrl: backend.url,
			algorithm,
			backendWeight: backend.weight,
			backendEnabled: backend.enabled,
			backendPriority: backend.priority
		};

		if (this.isDebugMode) {
			this.debug('Backend selected', selectionContext);
		} else {
			this.info(`Backend selected: ${backend.id} (${algorithm})`, {
				backendId: backend.id,
				algorithm
			});
		}
	}

	/**
	 * Log circuit breaker state changes
	 */
	logCircuitBreaker(backendId: string, oldState: string, newState: string, context: LogContext = {}): void {
		const circuitContext: LogContext = {
			...context,
			backendId,
			oldState,
			newState,
			timestamp: Date.now()
		};

		if (this.isDebugMode) {
			this.debug(`Circuit breaker state change: ${oldState} → ${newState}`, circuitContext);
		} else {
			this.warn(`Circuit breaker: ${backendId} ${oldState} → ${newState}`, {
				backendId,
				oldState,
				newState
			});
		}
	}

	/**
	 * Log session affinity events
	 */
	logSessionAffinity(sessionKey: string, backendId: string, action: 'created' | 'retrieved' | 'updated' | 'expired', context: LogContext = {}): void {
		const sessionContext: LogContext = {
			...context,
			sessionKey,
			backendId,
			action,
			timestamp: Date.now()
		};

		if (this.isDebugMode) {
			this.debug(`Session affinity: ${action}`, sessionContext);
		}
	}

	/**
	 * Log configuration changes
	 */
	logConfigChange(changeType: string, details: any, context: LogContext = {}): void {
		const configContext: LogContext = {
			...context,
			changeType,
			details: this.isDebugMode ? details : undefined,
			timestamp: Date.now()
		};

		if (this.isDebugMode) {
			this.debug(`Configuration change: ${changeType}`, configContext);
		} else {
			this.info(`Configuration updated: ${changeType}`, {
				changeType
			});
		}
	}

	/**
	 * Log metrics updates
	 */
	logMetrics(metrics: any, context: LogContext = {}): void {
		const metricsContext: LogContext = {
			...context,
			metrics: this.isDebugMode ? metrics : undefined,
			timestamp: Date.now()
		};

		if (this.isDebugMode) {
			this.debug('Metrics updated', metricsContext);
		}
	}

	/**
	 * Log DNS resolution attempts
	 */
	logDnsResolution(hostname: string, success: boolean, duration?: number, error?: string, context: LogContext = {}): void {
		const dnsContext: LogContext = {
			...context,
			hostname,
			success,
			duration,
			error
		};

		if (this.isDebugMode) {
			this.debug(`DNS resolution ${success ? 'succeeded' : 'failed'}`, dnsContext);
		} else {
			this.info(`DNS: ${hostname} ${success ? 'resolved' : 'failed'}${duration ? ` (${duration}ms)` : ''}`, {
				hostname,
				success,
				duration
			});
		}
	}

	/**
	 * Log fallback events
	 */
	logFallback(from: string, to: string, reason: string, context: LogContext = {}): void {
		const fallbackContext: LogContext = {
			...context,
			from,
			to,
			reason,
			timestamp: Date.now()
		};

		if (this.isDebugMode) {
			this.debug(`Fallback: ${from} → ${to} (${reason})`, fallbackContext);
		} else {
			this.warn(`Fallback: ${from} → ${to}`, {
				from,
				to,
				reason
			});
		}
	}

	/**
	 * Log performance metrics
	 */
	logPerformance(operation: string, duration: number, context: LogContext = {}): void {
		const perfContext: LogContext = {
			...context,
			operation,
			duration,
			timestamp: Date.now()
		};

		if (this.isDebugMode) {
			this.debug(`Performance: ${operation} took ${duration}ms`, perfContext);
		} else if (duration > 1000) { // Log slow operations even in non-debug mode
			this.warn(`Slow operation: ${operation} took ${duration}ms`, {
				operation,
				duration
			});
		}
	}

	/**
	 * Log state persistence events
	 */
	logPersistence(action: 'save' | 'load', entity: string, success: boolean, duration?: number, context: LogContext = {}): void {
		const persistContext: LogContext = {
			...context,
			action,
			entity,
			success,
			duration,
			timestamp: Date.now()
		};

		if (this.isDebugMode) {
			this.debug(`Persistence: ${action} ${entity} ${success ? 'succeeded' : 'failed'}`, persistContext);
		} else if (!success) {
			this.error(`Persistence failed: ${action} ${entity}`, {
				action,
				entity
			});
		}
	}

	private log(level: string, message: string, context: LogContext): void {
		const timestamp = new Date().toISOString();
		const logEntry = {
			timestamp,
			level: level.toUpperCase(),
			serviceId: this.serviceId,
			message,
			...context
		};

		// Use appropriate console method based on level
		switch (level) {
			case 'debug':
				console.log(`[${timestamp}] [DEBUG] [${this.serviceId}] ${message}`, context);
				break;
			case 'info':
				console.log(`[${timestamp}] [INFO] [${this.serviceId}] ${message}`, context);
				break;
			case 'warn':
				console.warn(`[${timestamp}] [WARN] [${this.serviceId}] ${message}`, context);
				break;
			case 'error':
				console.error(`[${timestamp}] [ERROR] [${this.serviceId}] ${message}`, context);
				break;
		}
	}

	private getClientIp(request: Request): string {
		// Try to get real IP from various headers
		const cfConnectingIp = request.headers.get('cf-connecting-ip');
		const xForwardedFor = request.headers.get('x-forwarded-for');
		const xRealIp = request.headers.get('x-real-ip');
		
		return cfConnectingIp || xForwardedFor?.split(',')[0] || xRealIp || 'unknown';
	}

	/**
	 * Create a child logger with additional context
	 */
	child(additionalContext: LogContext): Logger {
		const childLogger = new Logger({ DEBUG: this.isDebugMode ? 'true' : 'false' } as Env, this.serviceId);
		// Add additional context to all log calls
		const originalLog = childLogger.log.bind(childLogger);
		childLogger.log = (level: string, message: string, context: LogContext = {}) => {
			originalLog(level, message, { ...additionalContext, ...context });
		};
		return childLogger;
	}
} 