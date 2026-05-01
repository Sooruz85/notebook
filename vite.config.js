import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const anthropicKey = env.VITE_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '';

  return {
    root: '.',
    publicDir: 'public',
    server: {
      proxy: {
        '/api/claude': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: () => '/v1/messages',
          configure(proxy) {
            proxy.on('proxyReq', proxyReq => {
              if (anthropicKey) proxyReq.setHeader('x-api-key', anthropicKey);
              proxyReq.setHeader('anthropic-version', '2023-06-01');
            });
          }
        }
      }
    }
  };
});
