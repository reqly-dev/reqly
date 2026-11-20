import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // UI hedef API'ye asla doğrudan gitmez; her şey yerel backend üzerinden (TASARIM.md §8)
      // REQSTER_API_PROXY ile başka bir backend'e yönlendirilebilir (yan yana ikinci geliştirme/test örneği için)
      '/api': process.env.REQSTER_API_PROXY ?? 'http://127.0.0.1:7357',
    },
  },
});
