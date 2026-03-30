import React from 'react'
import ReactDOM from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import App from './App.jsx'
import '@aws-amplify/ui-react/styles.css'
import '@aws-amplify/ui-react-storage/styles.css'

// The first bucket in the list is used for Amplify's default Storage config.
// The StorageBrowser component handles per-location bucket resolution.
const buckets = JSON.parse(import.meta.env.VITE_S3_BUCKETS)

Amplify.configure({
  Auth: {
    Cognito: {
      identityPoolId: import.meta.env.VITE_IDENTITY_POOL_ID,
      allowGuestAccess: true,
    },
  },
  Storage: {
    S3: {
      bucket: buckets[0].bucket,
      region: import.meta.env.VITE_AWS_REGION,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
