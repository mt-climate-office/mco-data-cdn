import { useCallback, useEffect, useMemo, useState } from 'react'
import FileBrowser from './FileBrowser.jsx'
import ShortcutsHelp from './components/ShortcutsHelp.jsx'
import { FolderIcon, SunIcon, MoonIcon } from './components/Icons.jsx'
import { decodeSafe, encodeKey } from './lib/s3.js'

const BUCKETS = JSON.parse(import.meta.env.VITE_S3_BUCKETS)

const DEFAULT_UI = { query: '', sort: { by: 'name', dir: 1 }, view: 'list', recursive: false }

function getInitialTheme() {
  const stored = localStorage.getItem('mco-theme')
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

// The path is the route: /<bucket>/<prefix...>/. Everything the toolbar
// controls lives in the query string so a filtered, sorted view is linkable.
function parseLocation() {
  const parts = decodeSafe(window.location.pathname).replace(/^\//, '').split('/')
  const bucket = BUCKETS.find(b => b.label === parts[0]) || null
  const rest = bucket && parts.length > 1 ? parts.slice(1).join('/') : ''
  const path = rest && !rest.endsWith('/') ? `${rest}/` : rest

  const params = new URLSearchParams(window.location.search)
  const by = params.get('sort')
  const ui = {
    query: params.get('q') || '',
    sort: {
      by: ['name', 'kind', 'size', 'date'].includes(by) ? by : 'name',
      dir: params.get('dir') === 'desc' ? -1 : 1,
    },
    view: params.get('view') === 'grid' ? 'grid'
      : params.get('view') === 'list' ? 'list'
        : localStorage.getItem('mco-view') === 'grid' ? 'grid' : 'list',
    recursive: params.get('deep') === '1',
  }
  return { bucket, path, ui }
}

function uiToQuery(ui) {
  const params = new URLSearchParams()
  if (ui.query) params.set('q', ui.query)
  if (ui.sort.by !== 'name') params.set('sort', ui.sort.by)
  if (ui.sort.dir === -1) params.set('dir', 'desc')
  if (ui.view !== 'list') params.set('view', ui.view)
  if (ui.recursive) params.set('deep', '1')
  const s = params.toString()
  return s ? `?${s}` : ''
}

export default function App() {
  const initial = useMemo(parseLocation, [])
  const [theme, setTheme] = useState(getInitialTheme)
  const [bucket, setBucket] = useState(initial.bucket)
  const [path, setPath] = useState(initial.path)
  const [ui, setUi] = useState(initial.ui)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('mco-theme', theme)
  }, [theme])

  useEffect(() => { localStorage.setItem('mco-view', ui.view) }, [ui.view])

  useEffect(() => {
    document.title = bucket
      ? `${bucket.label}/${decodeSafe(path)} — MCO Data`
      : 'MCO Data Browser'
  }, [bucket, path])

  // Toolbar state edits replace the history entry; navigation pushes one.
  useEffect(() => {
    const url = (bucket ? `/${bucket.label}/${encodeKey(path)}` : '/') + uiToQuery(ui)
    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', url)
    }
  }, [ui, bucket, path])

  const navigate = useCallback((nextBucket, nextPath, nextUi) => {
    const ui2 = nextUi ?? { ...DEFAULT_UI, view: ui.view }
    setBucket(nextBucket)
    setPath(nextPath)
    setUi(ui2)
    const url = (nextBucket ? `/${nextBucket.label}/${encodeKey(nextPath)}` : '/') + uiToQuery(ui2)
    window.history.pushState(null, '', url)
  }, [ui.view])

  const goHome = useCallback(() => navigate(null, ''), [navigate])
  const navigatePath = useCallback(p => navigate(bucket, p), [navigate, bucket])

  useEffect(() => {
    const onPop = () => {
      const next = parseLocation()
      setBucket(next.bucket)
      setPath(next.path)
      setUi(next.ui)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const onKey = e => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
      if (e.key === '?') { e.preventDefault(); setHelpOpen(o => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  return (
    <div className="app">
      <nav className="mco-navbar">
        <a href="https://climate.umt.edu" target="_blank" rel="noopener noreferrer">
          <img className="mco-navbar-logo"
            src="https://climate.umt.edu/assets/images/MCO_logo_icon_only.png"
            alt="Montana Climate Office"
            onError={e => { e.target.style.display = 'none' }} />
        </a>
        <div className="mco-navbar-divider" />
        <button className="mco-navbar-brand" onClick={goHome} title="All data collections">
          <span className="mco-navbar-title">MCO Data Browser</span>
          <span className="mco-navbar-subtitle">A service of the Montana Climate Office</span>
        </button>
        <button className="btn btn-quiet" onClick={() => setHelpOpen(true)}
          title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
        <button className="mco-theme-toggle" onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </nav>

      <main className="browser">
        {bucket ? (
          <FileBrowser
            key={bucket.label}
            bucket={bucket}
            path={path}
            onNavigate={navigatePath}
            onHome={goHome}
            uiState={ui}
            setUiState={setUi}
          />
        ) : (
          <div className="home">
            <header className="home-head">
              <h1>Montana Climate Office data</h1>
              <p>
                Public archives of gridded climate, snow, and Mesonet observations,
                served over HTTPS with range-request support for cloud-optimized reads.
              </p>
            </header>
            <ul className="collections">
              {BUCKETS.map(b => (
                <li key={b.bucket}>
                  <button className="collection" onClick={() => navigate(b, '')}>
                    <FolderIcon className="ico ico-dir" />
                    <span className="collection-text">
                      <span className="collection-name">{b.label}</span>
                      <span className="collection-desc">
                        {b.description || `s3://${b.bucket}`}
                      </span>
                    </span>
                    <code className="collection-path">/{b.label}/</code>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
