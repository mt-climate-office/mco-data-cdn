import { useState, useEffect } from 'react'

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
  </svg>
)

const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
)

function humanSize(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

function formatDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Helper: get text content of first matching tag (namespace-agnostic)
function getTagText(parent, tag) {
  const el = parent.getElementsByTagName(tag)[0]
  return el ? el.textContent : ''
}

// List objects in a public S3 bucket via the REST API (no auth needed)
async function listS3(bucketDomain, prefix, continuationToken) {
  const params = new URLSearchParams({ 'list-type': '2', 'delimiter': '/' })
  if (prefix) params.set('prefix', prefix)
  if (continuationToken) params.set('continuation-token', continuationToken)

  const res = await fetch(`https://${bucketDomain}/?${params}`)
  const text = await res.text()
  const xml = new DOMParser().parseFromString(text, 'text/xml')

  // getElementsByTagName is namespace-agnostic (unlike querySelectorAll)
  const folders = [...xml.getElementsByTagName('CommonPrefixes')]
    .map(el => getTagText(el, 'Prefix'))
    .filter(Boolean)

  const files = [...xml.getElementsByTagName('Contents')]
    .filter(el => getTagText(el, 'Key') !== prefix)
    .map(el => ({
      key: getTagText(el, 'Key'),
      size: parseInt(getTagText(el, 'Size'), 10),
      lastModified: getTagText(el, 'LastModified'),
    }))

  const isTruncated = getTagText(xml, 'IsTruncated') === 'true'
  const nextToken = getTagText(xml, 'NextContinuationToken') || null

  return { folders, files, isTruncated, nextToken }
}

export default function FileBrowser({ bucket, path, onNavigate, onHome }) {
  const [folders, setFolders] = useState([])
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextToken, setNextToken] = useState(null)

  const cdnPrefix = `${window.location.origin}/${bucket.label}`

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setFolders([])
    setFiles([])
    setNextToken(null)

    listS3(bucket.domain, path)
      .then(result => {
        if (cancelled) return
        setFolders(result.folders)
        setFiles(result.files)
        setNextToken(result.isTruncated ? result.nextToken : null)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [bucket.domain, path])

  const loadMore = async () => {
    if (!nextToken) return
    setLoadingMore(true)
    try {
      const result = await listS3(bucket.domain, path, nextToken)
      setFolders(prev => [...prev, ...result.folders])
      setFiles(prev => [...prev, ...result.files])
      setNextToken(result.isTruncated ? result.nextToken : null)
    } catch (err) {
      setError(err.message)
    }
    setLoadingMore(false)
  }

  // Breadcrumb: / > label > seg1 > seg2 > ...
  const segments = path ? path.replace(/\/$/, '').split('/') : []

  return (
    <>
      <div className="breadcrumb">
        <button onClick={onHome}>/</button>
        <span className="breadcrumb-sep">/</span>
        {segments.length === 0 ? (
          <span className="breadcrumb-current">{bucket.label}</span>
        ) : (
          <button onClick={() => onNavigate('')}>{bucket.label}</button>
        )}
        {segments.map((seg, i) => {
          const segPath = segments.slice(0, i + 1).join('/') + '/'
          const isLast = i === segments.length - 1
          return (
            <span key={segPath}>
              <span className="breadcrumb-sep">/</span>
              {isLast ? (
                <span className="breadcrumb-current">{seg}</span>
              ) : (
                <button onClick={() => onNavigate(segPath)}>{seg}</button>
              )}
            </span>
          )
        })}
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : error ? (
        <div className="empty">Error: {error}</div>
      ) : folders.length === 0 && files.length === 0 ? (
        <div className="empty">No files found.</div>
      ) : (
        <>
          <table className="file-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="col-size">Size</th>
                <th className="col-date">Modified</th>
              </tr>
            </thead>
            <tbody>
              {folders.map(f => {
                const name = f.slice(path.length).replace(/\/$/, '')
                return (
                  <tr key={f}>
                    <td>
                      <div className="name-cell">
                        <FolderIcon />
                        <button className="folder-link" onClick={() => onNavigate(f)}>
                          {name}
                        </button>
                      </div>
                    </td>
                    <td className="col-size"><span className="size-text">&mdash;</span></td>
                    <td className="col-date"><span className="date-text">&mdash;</span></td>
                  </tr>
                )
              })}
              {files.map(f => {
                const name = f.key.slice(path.length)
                const href = `${cdnPrefix}/${f.key}`
                return (
                  <tr key={f.key}>
                    <td>
                      <div className="name-cell">
                        <FileIcon />
                        <a className="file-link" href={href} target="_blank" rel="noopener noreferrer">
                          {name}
                        </a>
                      </div>
                    </td>
                    <td className="col-size"><span className="size-text">{humanSize(f.size)}</span></td>
                    <td className="col-date"><span className="date-text">{formatDate(f.lastModified)}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {nextToken && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <button className="folder-link" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
