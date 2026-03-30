import { createStorageBrowser } from '@aws-amplify/ui-react-storage/browser'
import { fetchAuthSession } from 'aws-amplify/auth'

const REGION = import.meta.env.VITE_AWS_REGION
const BUCKETS = JSON.parse(import.meta.env.VITE_S3_BUCKETS)

const { StorageBrowser } = createStorageBrowser({
  filePreview: false,
  config: {
    region: REGION,

    // One browsable location per bucket.
    listLocations: async () => ({
      items: BUCKETS.map(({ label, bucket }) => ({
        bucket,
        id: bucket,
        permissions: ['get', 'list'],
        prefix: '',
        type: 'BUCKET',
      })),
      nextToken: undefined,
    }),

    getLocationCredentials: async () => {
      const session = await fetchAuthSession()
      return { credentials: session.credentials }
    },

    registerAuthListener: (_listener) => {},
  },
})

export default function App() {
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        padding: '0.75rem 1.5rem',
        background: '#1a3a5c',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexShrink: 0,
      }}>
        <img
          src="https://climate.umt.edu/img/MCO_logo_white.svg"
          alt="Montana Climate Office"
          style={{ height: '2rem' }}
          onError={(e) => { e.target.style.display = 'none' }}
        />
        <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>
          MCO Data Browser
        </span>
      </header>
      <main style={{ flex: 1, overflow: 'hidden' }}>
        <StorageBrowser />
      </main>
    </div>
  )
}
