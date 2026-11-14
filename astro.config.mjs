import { defineConfig } from 'astro/config';
import { siteConfig } from '@sapphirelabs/ui/config';

// Shared Sapphire Labs site setup: strict Content-Security-Policy, no
// third-party requests. HTTP-only headers (frame-ancestors etc.) are in vercel.json.
export default defineConfig(siteConfig({ site: 'https://meet.sapphire-labs.dev' }));
