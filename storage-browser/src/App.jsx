import { useState, useEffect } from 'react'
import FileBrowser from './FileBrowser.jsx'

const BUCKETS = JSON.parse(import.meta.env.VITE_S3_BUCKETS)

function getInitialTheme() {
  const stored = localStorage.getItem('mco-theme')
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const SunIcon = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
)
const MoonIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
)

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme)
  const [activeBucket, setActiveBucket] = useState(null)
  const [path, setPath] = useState('')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('mco-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  const goHome = () => { setActiveBucket(null); setPath('') }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <nav className="mco-navbar">
        <a href="https://climate.umt.edu" target="_blank" rel="noopener noreferrer">
          <img className="mco-navbar-logo"
            src="https://climate.umt.edu/assets/images/MCO_logo_icon_only.png"
            alt="Montana Climate Office"
            onError={(e) => { e.target.style.display = 'none' }} />
        </a>
        <div className="mco-navbar-divider" />
        <div className="mco-navbar-brand">
          <span className="mco-navbar-title">Montana Climate Office</span>
          <span className="mco-navbar-subtitle">Data Browser</span>
        </div>
        <button className="mco-theme-toggle" onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </nav>

      <div className="browser">
        {!activeBucket ? (
          <>
            <div className="breadcrumb">
              <span className="breadcrumb-current">/</span>
            </div>
            <table className="file-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="col-size">Size</th>
                  <th className="col-date">Modified</th>
                </tr>
              </thead>
              <tbody>
                {BUCKETS.map(b => (
                  <tr key={b.bucket}>
                    <td>
                      <div className="name-cell">
                        <FolderIcon />
                        <button className="folder-link"
                          onClick={() => { setActiveBucket(b); setPath('') }}>
                          {b.label}
                        </button>
                      </div>
                    </td>
                    <td className="col-size"><span className="size-text">&mdash;</span></td>
                    <td className="col-date"><span className="date-text">&mdash;</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <FileBrowser
            bucket={activeBucket}
            path={path}
            onNavigate={setPath}
            onHome={goHome}
          />
        )}
      </div>
    </div>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  )
}
