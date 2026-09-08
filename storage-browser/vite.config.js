import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The origin buckets' CORS rules only allow the production hosts, so `vite dev`
// lists through a local proxy instead of hitting S3 (or the CDN) directly.
// Each bucket's configured `domain` may carry a path (the private origin is
// listed through the CDN as <cdn-host>/<prefix>), so split host from path.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const buckets = JSON.parse(env.VITE_S3_BUCKETS || '[]')

  const proxy = {}
  for (const b of buckets) {
    const [host, ...rest] = b.domain.split('/')
    const basePath = rest.length ? `/${rest.join('/')}` : ''
    proxy[`/__s3/${b.label}`] = {
      target: `https://${host}`,
      changeOrigin: true,
      rewrite: path => basePath + path.replace(`/__s3/${b.label}`, ''),
    }
  }

  return {
    plugins: [react()],
    server: { proxy },
    build: { sourcemap: false },
  }
})
