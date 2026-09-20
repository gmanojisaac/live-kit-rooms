import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // xfwd makes the browser IP available in X-Forwarded-For. The API still ignores
    // that header unless TRUSTED_PROXY_IPS includes this peer (typically 127.0.0.1).
    proxy: { '/api': { target: 'http://127.0.0.1:3001', xfwd: true } },
  },
});
