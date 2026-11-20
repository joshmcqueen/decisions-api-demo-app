import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/tmp/**', '**/test-results/**', '**/playwright-report/**'] },
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc',
        '.yarnrc.yml',
        '**/.git/**',
        '**/tmp/**',
        '**/*.sqlite*',
        '**/eval/*.json',
        '**/test-results/**',
        '**/playwright-report/**',
      ],
    },
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/products': 'http://127.0.0.1:3001',
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
