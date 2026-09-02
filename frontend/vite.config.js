import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    base: '/static/',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: { output: { entryFileNames: 'assets/index.js', assetFileNames: 'assets/index.[ext]' } },
    },
    server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8000' } },
    test: { environment: 'jsdom', setupFiles: './src/test/setup.ts' },
});
