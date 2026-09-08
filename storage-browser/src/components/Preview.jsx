import { useEffect, useMemo, useRef, useState } from 'react'
import { fileUrl, s3Uri } from '../lib/s3.js'
import { humanSize, exactDate, typeOf, IMAGE_PREVIEW, NATIVE_VIEW } from '../lib/format.js'
import { renderMarkdown } from '../lib/markdown.js'
import { CloseIcon, SpinnerIcon } from './Icons.jsx'
import CopyMenu from './CopyMenu.jsx'

// Only the head of a file is fetched — these buckets hold multi-GB rasters.
const PREVIEW_CAP = 512 * 1024
const CSV_ROW_CAP = 500

// RFC 4180-ish: quoted fields, doubled quotes, embedded newlines.
function parseDelimited(text, sep) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === sep) { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
    if (rows.length > CSV_ROW_CAP) break
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

export default function Preview({ bucket, entry, onClose, onPrev, onNext }) {
  const [state, setState] = useState({ status: 'loading' })
  const panelRef = useRef(null)

  const url = fileUrl(bucket, entry.key)
  const { ext, label } = typeOf(entry.name)
  const name = entry.name.split('/').pop()

  const mode = IMAGE_PREVIEW.has(ext) ? 'image'
    : NATIVE_VIEW.has(ext) ? 'frame'
      : 'text'

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowLeft' && onPrev) { e.preventDefault(); onPrev() }
      else if (e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext() }
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  useEffect(() => {
    if (mode !== 'text') { setState({ status: 'ready' }); return }
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetch(url, { headers: { Range: `bytes=0-${PREVIEW_CAP - 1}` }, signal: controller.signal })
      .then(async res => {
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        setState({ status: 'ready', text: text.slice(0, PREVIEW_CAP) })
      })
      .catch(err => {
        if (err.name === 'AbortError') return
        setState({ status: 'error', message: err.message })
      })
    return () => controller.abort()
  }, [url, mode])

  const body = useMemo(() => {
    if (state.status !== 'ready' || mode !== 'text' || state.text == null) return null
    const text = state.text
    if (ext === 'md') {
      return <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
    }
    if (ext === 'csv' || ext === 'tsv') {
      const rows = parseDelimited(text, ext === 'tsv' ? '\t' : ',')
      if (rows.length > 1) {
        const [head, ...rest] = rows
        return (
          <div className="preview-table-wrap">
            <table className="preview-table">
              <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
              <tbody>
                {rest.map((r, i) => (
                  <tr key={i}>{head.map((_, j) => <td key={j}>{r[j] ?? ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    }
    if (ext === 'json' || ext === 'geojson' || ext === 'topojson') {
      try {
        return <pre className="preview-body">{JSON.stringify(JSON.parse(text), null, 2)}</pre>
      } catch {
        // A truncated document won't parse; fall through to the raw head.
      }
    }
    return <pre className="preview-body">{text || '(empty file)'}</pre>
  }, [state, mode, ext])

  const truncatedNote = mode === 'text' && entry.size > PREVIEW_CAP
    ? `Showing the first ${humanSize(PREVIEW_CAP)} of ${humanSize(entry.size)} — open or download for the whole file.`
    : ''

  return (
    <div className="preview-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="preview-panel" role="dialog" aria-modal="true" aria-label={`Preview of ${name}`}
        tabIndex={-1} ref={panelRef}>
        <header className="preview-head">
          <div className="preview-title">
            <span className="preview-name">{name}</span>
            <span className="preview-meta">
              {label} · {humanSize(entry.size)}
              {entry.modified ? ` · ${exactDate(entry.modified)}` : ''}
            </span>
          </div>
          <div className="preview-actions">
            <CopyMenu
              items={[
                { label: 'HTTPS URL', value: url },
                { label: 'S3 URI', value: s3Uri(bucket, entry.key) },
                { label: 'GDAL /vsicurl/', value: `/vsicurl/${url}` },
              ]}
            />
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Open</a>
            <a className="btn" href={url} download={name}>Download</a>
            <button className="btn icon-btn" onClick={onClose} aria-label="Close preview">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="preview-content">
          {state.status === 'loading' && (
            <div className="preview-state"><SpinnerIcon /> Loading preview…</div>
          )}
          {state.status === 'error' && (
            <div className="preview-state">
              Couldn&rsquo;t load a preview — {state.message}.{' '}
              <a href={url} target="_blank" rel="noopener noreferrer">Open the file directly</a>.
            </div>
          )}
          {state.status === 'ready' && mode === 'image' && (
            <div className="preview-image"><img src={url} alt={name} /></div>
          )}
          {state.status === 'ready' && mode === 'frame' && (
            <iframe className="preview-frame" src={url} title={name} />
          )}
          {state.status === 'ready' && body}
        </div>

        {(truncatedNote || onPrev || onNext) && (
          <footer className="preview-foot">
            <span>{truncatedNote}</span>
            {(onPrev || onNext) && (
              <span className="preview-nav">
                <button className="btn" onClick={onPrev} disabled={!onPrev}>&larr; Prev</button>
                <button className="btn" onClick={onNext} disabled={!onNext}>Next &rarr;</button>
              </span>
            )}
          </footer>
        )}
      </div>
    </div>
  )
}
