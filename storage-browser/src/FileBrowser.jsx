import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listAll, fileUrl, s3Uri, decodeSafe, encodeKey } from './lib/s3.js'
import {
  typeOf, compareNames, pluralize,
  TEXT_PREVIEW, IMAGE_PREVIEW, NATIVE_VIEW,
} from './lib/format.js'
import { renderMarkdown } from './lib/markdown.js'
import Toolbar from './components/Toolbar.jsx'
import EntryList from './components/EntryList.jsx'
import Preview from './components/Preview.jsx'
import CopyMenu, { copyText } from './components/CopyMenu.jsx'
import { SpinnerIcon } from './components/Icons.jsx'

const README_CAP = 256 * 1024
const README_NAMES = ['readme.md', 'readme.txt', 'index.md']

const parentOf = prefix => prefix.replace(/[^/]+\/$/, '')

// Entries a click should open in the preview modal rather than navigating to.
function isPreviewable(name) {
  const { ext } = typeOf(name)
  return TEXT_PREVIEW.has(ext) || IMAGE_PREVIEW.has(ext)
}

export default function FileBrowser({
  bucket, path, onNavigate, onHome, uiState, setUiState,
}) {
  const { query, sort, view, recursive } = uiState
  const [listing, setListing] = useState({ status: 'loading', dirs: [], files: [], truncated: false })
  const [scanned, setScanned] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [readme, setReadme] = useState(null)
  const [cursor, setCursor] = useState(-1)
  const [previewKey, setPreviewKey] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)

  const searchRef = useRef(null)
  const scanAbort = useRef(null)

  // ---- listing --------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController()
    scanAbort.current = controller
    let dirs = []
    let files = []

    setListing({ status: 'loading', dirs: [], files: [], truncated: false })
    setScanned(0)
    setScanning(recursive)
    setCursor(-1)

    listAll(bucket, {
      prefix: path,
      // An empty delimiter walks every prefix below this one.
      delimiter: recursive ? '' : '/',
      signal: controller.signal,
      maxPages: recursive ? 50 : 25,
      onPage: (page, index) => {
        dirs = dirs.concat(page.dirs)
        files = files.concat(page.files)
        setScanned(dirs.length + files.length)
        // Only surface progress once a listing needs a second page.
        if (index > 0) setScanning(true)
        // Show the first page immediately; later pages stream in behind it.
        setListing({ status: 'ready', dirs, files, truncated: false })
      },
    })
      .then(({ truncated }) => {
        if (controller.signal.aborted) return
        setListing({ status: 'ready', dirs, files, truncated })
        setScanning(false)
      })
      .catch(err => {
        if (err.name === 'AbortError') { setScanning(false); return }
        setListing({ status: 'error', error: err, dirs: [], files: [], truncated: false })
        setScanning(false)
      })

    return () => controller.abort()
  }, [bucket, path, recursive, reloadToken])

  // ---- README ---------------------------------------------------------
  // Keyed on the file itself, so streaming in later pages of a big listing
  // doesn't refetch it.
  const readmeKey = useMemo(() => {
    if (recursive) return null
    const hit = listing.files.find(f =>
      README_NAMES.includes(f.key.slice(path.length).toLowerCase()))
    return hit ? hit.key : null
  }, [listing.files, path, recursive])

  useEffect(() => {
    setReadme(null)
    if (!readmeKey) return

    const controller = new AbortController()
    fetch(fileUrl(bucket, readmeKey), {
      headers: { Range: `bytes=0-${README_CAP - 1}` },
      signal: controller.signal,
    })
      .then(res => (res.ok || res.status === 206 ? res.text() : Promise.reject(new Error(res.status))))
      .then(text => setReadme({ name: readmeKey.slice(path.length), html: renderMarkdown(text) }))
      .catch(() => {})
    return () => controller.abort()
  }, [bucket, path, readmeKey])

  // ---- entries --------------------------------------------------------
  const entries = useMemo(() => {
    const dirs = listing.dirs.map(prefix => ({
      type: 'dir',
      key: prefix,
      name: prefix.slice(path.length).replace(/\/$/, ''),
      size: 0,
      modified: '',
    }))
    const files = listing.files.map(f => ({
      type: 'file',
      key: f.key,
      name: f.key.slice(path.length),
      size: f.size,
      modified: f.modified,
    }))
    return [...dirs, ...files]
  }, [listing.dirs, listing.files, path])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    const terms = q.split(/\s+/)
    return entries.filter(e => {
      const hay = decodeSafe(e.name).toLowerCase()
      return terms.every(t => hay.includes(t))
    })
  }, [entries, query])

  const sorted = useMemo(() => {
    const { by, dir } = sort
    const copy = [...filtered]
    copy.sort((a, b) => {
      // Folders always lead, whichever way the column sorts.
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      if (by === 'size') return (a.size - b.size) * dir || compareNames(a.name, b.name)
      if (by === 'date') return (a.modified < b.modified ? -1 : a.modified > b.modified ? 1 : 0) * dir
      if (by === 'kind') {
        const ka = typeOf(a.name).label
        const kb = typeOf(b.name).label
        return (compareNames(ka, kb) * dir) || compareNames(a.name, b.name)
      }
      return compareNames(decodeSafe(a.name), decodeSafe(b.name)) * dir
    })
    return copy
  }, [filtered, sort])

  // The parent link rides at the top of the list so it survives sorting.
  const rows = useMemo(() => {
    const up = { type: 'up', key: parentOf(path), name: '..', size: 0, modified: '' }
    return [up, ...sorted]
  }, [sorted, path])

  const stats = useMemo(() => {
    let folders = 0
    let files = 0
    let bytes = 0
    for (const e of entries) {
      if (e.type === 'dir') folders++
      else { files++; bytes += e.size }
    }
    return { folders, files, bytes, shown: sorted.length, total: entries.length }
  }, [entries, sorted.length])

  // ---- navigation -----------------------------------------------------
  const open = useCallback(entry => {
    if (entry.type === 'up') {
      if (!path) onHome()
      else onNavigate(parentOf(path))
      return
    }
    if (entry.type === 'dir') { onNavigate(entry.key); return }
    if (isPreviewable(entry.name)) { setPreviewKey(entry.key); return }
    const { ext } = typeOf(entry.name)
    const url = fileUrl(bucket, entry.key)
    if (NATIVE_VIEW.has(ext)) window.open(url, '_blank', 'noopener')
    else {
      // Anything else is a download: rasters and archives here are huge.
      const a = document.createElement('a')
      a.href = url
      a.download = entry.name.split('/').pop()
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  }, [bucket, path, onNavigate, onHome])

  const onSort = useCallback(by => {
    setUiState(s => ({
      ...s,
      sort: { by, dir: s.sort.by === by ? -s.sort.dir : 1 },
    }))
  }, [setUiState])

  // ---- preview navigation --------------------------------------------
  const previewables = useMemo(
    () => sorted.filter(e => e.type === 'file' && isPreviewable(e.name)),
    [sorted])
  const previewIndex = previewables.findIndex(e => e.key === previewKey)
  const previewEntry = previewIndex >= 0 ? previewables[previewIndex] : null

  // ---- keyboard -------------------------------------------------------
  useEffect(() => {
    const onKey = e => {
      const tag = e.target.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable
      if (typing) {
        if (e.key === 'Escape') { e.target.blur(); setUiState(s => ({ ...s, query: '' })) }
        return
      }
      if (previewKey) return // the modal owns the keyboard
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const last = rows.length - 1
      switch (e.key) {
        case '/':
        case 'f':
          e.preventDefault()
          searchRef.current?.focus()
          searchRef.current?.select()
          break
        case 'j':
        case 'ArrowDown':
          e.preventDefault(); setCursor(c => Math.min(last, c + 1)); break
        case 'k':
        case 'ArrowUp':
          e.preventDefault(); setCursor(c => Math.max(0, c - 1)); break
        case 'Enter':
          if (cursor >= 0 && rows[cursor]) { e.preventDefault(); open(rows[cursor]) }
          break
        case 'Backspace':
        case 'u':
        case 'ArrowLeft':
          e.preventDefault(); open(rows[0]); break
        case 'g':
          e.preventDefault(); setCursor(0); break
        case 'G':
          e.preventDefault(); setCursor(last); break
        case 'v':
          e.preventDefault(); setUiState(s => ({ ...s, view: s.view === 'list' ? 'grid' : 'list' })); break
        case 'r':
          e.preventDefault(); setUiState(s => ({ ...s, recursive: !s.recursive })); break
        case 'Escape':
          if (query) { e.preventDefault(); setUiState(s => ({ ...s, query: '' })) }
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, cursor, open, previewKey, query, setUiState])

  // ---- bulk actions ---------------------------------------------------
  const fileRows = useMemo(() => sorted.filter(e => e.type === 'file'), [sorted])

  const urlList = useCallback(
    () => fileRows.map(e => fileUrl(bucket, e.key)).join('\n'),
    [fileRows, bucket])

  const downloadUrlList = useCallback(() => {
    const blob = new Blob([`${urlList()}\n`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${bucket.label}-${(path || 'root').replace(/\//g, '_')}-urls.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, [urlList, bucket.label, path])

  const bulkActions = fileRows.length > 0 && (
    <span className="bulk">
      <CopyMenu
        title={`Copy links for ${pluralize(fileRows.length, 'file')}`}
        items={[
          { label: `${pluralize(fileRows.length, 'URL')}`, value: urlList() },
          { label: 'S3 URIs', value: fileRows.map(e => s3Uri(bucket, e.key)).join('\n') },
          { label: 'wget command', value: `wget -c -i - <<'EOF'\n${urlList()}\nEOF` },
        ]}
      />
      <button className="btn" onClick={downloadUrlList} title="Save the URL list as a text file">
        urls.txt
      </button>
    </span>
  )

  // ---- render ---------------------------------------------------------
  const segments = path ? path.replace(/\/$/, '').split('/') : []

  return (
    <>
      <nav className="crumbs" aria-label="Location">
        <button onClick={onHome}>data</button>
        <span className="sep">/</span>
        {segments.length === 0
          ? <span className="here">{bucket.label}</span>
          : <button onClick={() => onNavigate('')}>{bucket.label}</button>}
        {segments.map((seg, i) => {
          const segPath = `${segments.slice(0, i + 1).join('/')}/`
          const isLast = i === segments.length - 1
          return (
            <span key={segPath} className="crumb">
              <span className="sep">/</span>
              {isLast
                ? <span className="here">{decodeSafe(seg)}</span>
                : <button onClick={() => onNavigate(segPath)}>{decodeSafe(seg)}</button>}
            </span>
          )
        })}
        <CopyMenu
          compact
          title="Copy a link to this folder"
          items={[{ label: 'Folder URL', value: `${window.location.origin}/${bucket.label}/${encodeKey(path)}` }]}
        />
      </nav>

      <Toolbar
        query={query}
        onQuery={q => setUiState(s => ({ ...s, query: q }))}
        inputRef={searchRef}
        recursive={recursive}
        onRecursive={on => setUiState(s => ({ ...s, recursive: on }))}
        view={view}
        onView={v => setUiState(s => ({ ...s, view: v }))}
        stats={stats}
        scan={{ active: scanning, scanned, onCancel: () => scanAbort.current?.abort() }}
        actions={bulkActions}
      />

      {listing.status === 'error' ? (
        <div className="state">
          <p>Couldn&rsquo;t list <code>{bucket.label}/{path}</code> — {listing.error.message}.</p>
          <button className="btn" onClick={() => setReloadToken(t => t + 1)}>Try again</button>
        </div>
      ) : listing.status === 'loading' ? (
        <div className="state"><SpinnerIcon /> Reading {bucket.label}/{decodeSafe(path)}…</div>
      ) : (
        <>
          <EntryList
            bucket={bucket}
            entries={rows}
            view={view}
            sort={sort}
            onSort={onSort}
            onOpen={open}
            cursor={cursor}
            onCursor={setCursor}
            showFullKey={recursive}
            footer={
              <>
                {listing.truncated && (
                  <p className="note">
                    This prefix is very large — showing the first{' '}
                    {(listing.dirs.length + listing.files.length).toLocaleString()} entries.
                    Narrow the path to see the rest.
                  </p>
                )}
                {sorted.length === 0 && (
                  <p className="note">
                    {query ? `Nothing here matches “${query}”.` : 'This folder is empty.'}
                  </p>
                )}
                {readme && (
                  <section className="readme">
                    <h2 className="readme-head">{readme.name}</h2>
                    <div className="prose" dangerouslySetInnerHTML={{ __html: readme.html }} />
                  </section>
                )}
              </>
            }
          />
        </>
      )}

      {previewEntry && (
        <Preview
          bucket={bucket}
          entry={previewEntry}
          onClose={() => setPreviewKey(null)}
          onPrev={previewIndex > 0 ? () => setPreviewKey(previewables[previewIndex - 1].key) : null}
          onNext={previewIndex < previewables.length - 1
            ? () => setPreviewKey(previewables[previewIndex + 1].key)
            : null}
        />
      )}
    </>
  )
}
