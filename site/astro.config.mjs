import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: process.env.SITE_URL,
  adapter: vercel(),
  prefetch: {
    prefetchAll: false
  }
});
