# OAuth Setup Guide

This guide will walk you through setting up OAuth authentication for your Cloudflare Load Balancer Worker.

## 🔧 Prerequisites

1. A deployed Cloudflare Worker (get your worker URL first)
2. GitHub account (for GitHub OAuth)
3. Google Cloud account (for Google OAuth)

## 🐙 GitHub OAuth Setup

### Step 1: Create a GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in the application details:
   - **Application name**: `Load Balancer Control Panel` (or your preferred name)
   - **Homepage URL**: `https://your-worker.your-subdomain.workers.dev`
   - **Application description**: `OAuth app for load balancer management`
   - **Authorization callback URL**: `https://your-worker.your-subdomain.workers.dev/auth/github/callback`

### Step 2: Get Your Credentials

1. After creating the app, note down:
   - **Client ID** (visible immediately)
   - **Client Secret** (click "Generate a new client secret")

⚠️ **Important**: Keep your Client Secret secure and never commit it to version control.

## 🔍 Google OAuth Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API (if not already enabled)

### Step 2: Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Choose **External** user type (unless you have a Google Workspace)
3. Fill in the required information:
   - **App name**: `Load Balancer Control Panel`
   - **User support email**: Your email
   - **Developer contact information**: Your email
4. Add scopes: `email` and `profile`
5. Add test users (your email addresses that should have access)

### Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **"Create Credentials"** > **"OAuth 2.0 Client IDs"**
3. Choose **Web application**
4. Configure:
   - **Name**: `Load Balancer Worker`
   - **Authorized redirect URIs**: `https://your-worker.your-subdomain.workers.dev/auth/google/callback`

### Step 4: Get Your Credentials

1. Note down:
   - **Client ID**
   - **Client Secret**

## ⚙️ Worker Configuration

### Update wrangler.toml

Replace the placeholder values in your `wrangler.toml`:

```toml
[vars]
# OAuth Configuration
JWT_SECRET = "your-super-secret-jwt-key-change-this-in-production"
GITHUB_CLIENT_ID = "your-github-client-id-here"
GITHUB_CLIENT_SECRET = "your-github-client-secret-here"
GOOGLE_CLIENT_ID = "your-google-client-id-here"
GOOGLE_CLIENT_SECRET = "your-google-client-secret-here"
AUTHORIZED_USERS = "your-email@example.com,colleague@example.com"
```

### Environment Variables Explained

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | Secret key for signing JWT tokens | `super-secret-key-min-32-chars` |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | `Iv1.a1b2c3d4e5f6g7h8` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | `1234567890abcdef...` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | `123456789-abc.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | `GOCSPX-abcd1234...` |
| `AUTHORIZED_USERS` | Comma-separated list of authorized emails | `admin@company.com,dev@company.com` |

## 🔐 Security Best Practices

### JWT Secret

- Use a strong, random string (minimum 32 characters)
- Generate with: `openssl rand -base64 32`
- Never reuse across environments

### OAuth Secrets

- Store securely in Cloudflare Workers environment
- Use different OAuth apps for development/production
- Regularly rotate secrets

### Authorized Users

- Only include necessary email addresses
- Use corporate email addresses when possible
- Review the list regularly

## 🚀 Deployment

### 1. Deploy with Secrets

For production, use Cloudflare Workers secrets instead of environment variables:

```bash
# Set OAuth secrets
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put JWT_SECRET

# Deploy
wrangler deploy
```

### 2. Test the Setup

1. Navigate to your worker URL
2. Try logging in with GitHub
3. Try logging in with Google
4. Verify that unauthorized emails are rejected

## 🛠️ Troubleshooting

### Common Issues

#### "Authorization failed" Error

- Check that your callback URLs match exactly
- Ensure OAuth apps are not in development mode (for Google)
- Verify client IDs are correct

#### "Access denied" Error

- Check that your email is in the `AUTHORIZED_USERS` list
- Ensure email addresses match exactly (case-sensitive)
- Verify the OAuth provider returned the correct email

#### "Failed to get user information" Error

- Check client secrets are correct
- Ensure OAuth apps have proper permissions
- Verify API scopes include email access

### Debug Mode

Enable debug logging by setting:

```toml
DEBUG = "true"
```

This will log OAuth flow details to the Cloudflare Workers console.

## 🔄 Development vs Production

### Development Setup

- Use separate OAuth apps for development
- Set callback URLs to your local development server
- Use test email addresses

### Production Setup

- Use production OAuth apps
- Set callback URLs to your production worker domain
- Use real email addresses
- Store secrets securely

## 📋 Checklist

Before going live, ensure:

- [ ] GitHub OAuth app created with correct callback URL
- [ ] Google OAuth app created with correct callback URL
- [ ] Google OAuth consent screen configured
- [ ] All environment variables set in wrangler.toml
- [ ] JWT secret is strong and unique
- [ ] Authorized users list is correct
- [ ] OAuth secrets stored securely (not in version control)
- [ ] Worker deployed and accessible
- [ ] Login flow tested with authorized users
- [ ] Unauthorized access properly rejected

## 🆘 Support

If you encounter issues:

1. Check the Cloudflare Workers logs
2. Verify OAuth app configurations
3. Test with a simple OAuth flow first
4. Review the callback URLs carefully
5. Ensure all secrets are properly set

Remember: OAuth setup can be tricky, but once configured correctly, it provides a secure and user-friendly authentication experience!
