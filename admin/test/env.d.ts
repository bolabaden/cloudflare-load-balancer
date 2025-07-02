/// <reference types="vitest" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_APP_TITLE: string
	// Add other env variables here
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {}
}
