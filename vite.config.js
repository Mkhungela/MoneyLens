import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxy = {
  target: 'http://127.0.0.1:8787',
  changeOrigin: true,
  configure: (proxy) => proxy.on('proxyReq', (proxyReq, req) => {
    proxyReq.setHeader('x-forwarded-host', req.headers.host || '');
  }),
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: { '/api': apiProxy },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: { '/api': apiProxy },
  },
});
