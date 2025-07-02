# Static Files System

This directory contains static assets (CSS, JavaScript, HTML templates) that are bundled into the Cloudflare Worker at build time.

## Directory Structure

```shell
static/
├── css/
│   ├── login.css       # Styles for the login page
│   └── dashboard.css   # Styles for the dashboard
├── js/
│   └── dashboard.js    # JavaScript for dashboard functionality
├── templates/
│   ├── login.html      # Login page template
│   └── dashboard.html  # Dashboard page template
└── README.md          # This file
```

## Template Variables

Templates support simple variable substitution using `{{VARIABLE_NAME}}` syntax:

### Login Template Variables

- `{{ERROR_MESSAGE}}` - Error message to display (if any)

### Dashboard Template Variables

- `{{USER_NAME}}` - Authenticated user's name
- `{{USER_EMAIL}}` - Authenticated user's email
- `{{API_SECRET}}` - API secret for JavaScript API calls

## Development Workflow

1. Edit CSS/JS/HTML files in this directory
2. Run `npm run build:static` to regenerate the TypeScript module
3. Deploy with `npm run deploy` (automatically runs build:static)

## Benefits

- ✅ No more escaped strings in TypeScript
- ✅ Proper syntax highlighting and formatting
- ✅ Easy to maintain and edit
- ✅ Automatic bundling for Cloudflare Workers
- ✅ Template system for dynamic content
- ✅ Proper MIME types and caching headers
