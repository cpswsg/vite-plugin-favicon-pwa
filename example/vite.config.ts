import { defineConfig } from 'vite';
import faviconPwa from 'vite-plugin-favicon-pwa';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    faviconPwa({
      source: 'public/mark.svg',
      name: 'Favicon Lab',
      shortName: 'Icon Lab',
      description: 'A visual example for vite-plugin-favicon-pwa.',
      background: 'oklch(96% 0.03 85)',
      foreground: 'oklch(30% 0.08 255)',
      themeColor: 'oklch(30% 0.08 255)',
      padding: 0.12,
      maskablePadding: 0.3,
      radius: 0.2,
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
