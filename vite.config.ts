import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    watch: {
      // cargo/tauri 编译输出与运行时数据不参与前端热更新，避免 EBUSY 与无效重载。
      ignored: [
        '**/src-tauri/**',
        '**/server/data/**',
        '**/dist/**',
        '**/.*.tmpdir/**',
        '**/.test-temp/**'
      ]
    },
    proxy: {
      '/api': 'http://127.0.0.1:5174',
      '/plugins': 'http://127.0.0.1:5174',
      '/ws': { target: 'ws://127.0.0.1:5174', ws: true }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          antd: ['antd', '@ant-design/icons']
        }
      }
    }
  }
})
