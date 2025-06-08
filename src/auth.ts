import jwt from '@tsndr/cloudflare-worker-jwt';

// Authentication utilities
export function basicAuth(request: Request, username: string, password: string): boolean {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader || !authHeader.startsWith('Basic ')) {
		return false;
	}
	
	const encoded = authHeader.substring(6);
	const decoded = atob(encoded);
	const [user, pass] = decoded.split(':');
	
	return user === username && pass === password;
}

export interface OAuthUser {
	email: string;
	name: string;
	avatar?: string;
	provider: 'github' | 'google';
	id: string;
}

export interface SessionData {
	user: OAuthUser;
	exp: number;
	iat: number;
}

export async function verifyJWT(token: string, secret: string): Promise<SessionData | null> {
	try {
		const isValid = await jwt.verify(token, secret);
		if (!isValid) return null;
		
		const payload = jwt.decode(token);
		return payload.payload as SessionData;
	} catch (error) {
		console.error('JWT verification failed:', error);
		return null;
	}
}

export async function createJWT(user: OAuthUser, secret: string): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const payload: SessionData = {
		user,
		iat: now,
		exp: now + (24 * 60 * 60) // 24 hours
	};

	return await jwt.sign(payload, secret);
}

export function isUserAuthorized(email: string, authorizedUsers: string): boolean {
	const authorized = authorizedUsers.split(',').map(e => e.trim().toLowerCase());
	return authorized.includes(email.toLowerCase());
}

export function generateRandomState(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function getAuthCookie(request: Request): string | null {
	const cookieHeader = request.headers.get('Cookie');
	if (!cookieHeader) return null;
	
	const cookies = cookieHeader.split(';').map(c => c.trim());
	for (const cookie of cookies) {
		const [name, value] = cookie.split('=');
		if (name === 'auth_token') {
			return value;
		}
	}
	return null;
}

export async function authenticateRequest(request: Request, env: Env): Promise<OAuthUser | null> {
	// Try JWT from cookie first
	const token = getAuthCookie(request);
	if (token) {
		const session = await verifyJWT(token, env.JWT_SECRET);
		if (session && session.exp > Math.floor(Date.now() / 1000)) {
			return session.user;
		}
	}
	
	// Fallback to basic auth for backward compatibility with API
	const authHeader = request.headers.get('Authorization');
	if (authHeader?.startsWith('Basic ')) {
		if (basicAuth(request, env.WEB_AUTH_USERNAME, env.WEB_AUTH_PASSWORD)) {
			return {
				email: 'admin@local',
				name: 'Admin',
				provider: 'github',
				id: 'local-admin'
			};
		}
	}
	
	return null;
}

export async function exchangeGitHubCode(code: string, env: Env): Promise<OAuthUser | null> {
	try {
		// Exchange code for access token
		const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				client_id: env.GITHUB_CLIENT_ID,
				client_secret: env.GITHUB_CLIENT_SECRET,
				code: code,
			}),
		});

		const tokenData = await tokenResponse.json() as any;
		if (!tokenData.access_token) {
			console.error('No access token received from GitHub');
			return null;
		}

		// Get user info
		const userResponse = await fetch('https://api.github.com/user', {
			headers: {
				'Authorization': `Bearer ${tokenData.access_token}`,
				'User-Agent': 'LoadBalancer-Worker',
			},
		});

		const userData = await userResponse.json() as any;
		
		// Get primary email
		const emailResponse = await fetch('https://api.github.com/user/emails', {
			headers: {
				'Authorization': `Bearer ${tokenData.access_token}`,
				'User-Agent': 'LoadBalancer-Worker',
			},
		});

		const emails = await emailResponse.json() as any[];
		const primaryEmail = emails.find(email => email.primary)?.email || userData.email;

		if (!primaryEmail) {
			console.error('No email found for GitHub user');
			return null;
		}

		return {
			email: primaryEmail,
			name: userData.name || userData.login,
			avatar: userData.avatar_url,
			provider: 'github',
			id: userData.id.toString(),
		};
	} catch (error) {
		console.error('GitHub OAuth error:', error);
		return null;
	}
}

export async function exchangeGoogleCode(code: string, redirectUri: string, env: Env): Promise<OAuthUser | null> {
	try {
		// Exchange code for access token
		const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				code: code,
				client_id: env.GOOGLE_CLIENT_ID,
				client_secret: env.GOOGLE_CLIENT_SECRET,
				redirect_uri: redirectUri,
				grant_type: 'authorization_code',
			}),
		});

		const tokenData = await tokenResponse.json() as any;
		if (!tokenData.access_token) {
			console.error('No access token received from Google');
			return null;
		}

		// Get user info
		const userResponse = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${tokenData.access_token}`);
		const userData = await userResponse.json() as any;

		if (!userData.email) {
			console.error('No email found for Google user');
			return null;
		}

		return {
			email: userData.email,
			name: userData.name,
			avatar: userData.picture,
			provider: 'google',
			id: userData.id,
		};
	} catch (error) {
		console.error('Google OAuth error:', error);
		return null;
	}
} 