import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fileUrl, s3Uri, decodeSafe, encodeKey } from '../lib/s3.js'
import { humanSize, humanDate, exactDate, typeOf } from '../lib/format.js'
import { FolderIcon, FileIcon, UpIcon } from './Icons.jsx'
import CopyMenu from './CopyMenu.jsx'

const ROW_H = 36
const GRID_MIN_W = 210
const GRID_H = 84
const OVERSCAN = 8

const SORTS = [
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind', className: 'col-kind' },
  { key: 'size', label: 'Size', className: 'col-size' },
  { key: 'date', label: 'Modified', className: 'col-date' },
]

// Tracks the scroll offset and viewport height of the list container so only
// the visible slice is rendered — some prefixes here hold tens of thousands
// of date-stamped entries.
function useViewport(ref) {
  const [box, setBox] = useState({ top: 0, height: 600, width: 900 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox(b => ({ ...b, height: el.clientHeight, width: el.clientWidth }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  const onScroll = useCallback(e => {
    const top = e.currentTarget.scrollTop
    setBox(b => (Math.abs(b.top - top) < 1 ? b : { ...b, top }))
  }, [])

  return [box, onScroll]
}

// A subfolder-search hit is a whole relative path: let the leading folders
// truncate and keep the file name itself intact.
function EntryName({ text, splitPath }) {
  const cut = splitPath ? text.lastIndexOf('/') + 1 : 0
  if (!cut) return <span className="entry-name">{text}</span>
  return (
    <span className="entry-name entry-path">
      <span className="path-dirs">{text.slice(0, cut)}</span>
      <span className="path-base">{text.slice(cut)}</span>
    </span>
  )
}

function entryHref(bucket, entry) {
  return entry.type === 'file'
    ? fileUrl(bucket, entry.key)
    : `/${bucket.label}/${encodeKey(entry.key)}`
}

function copyItems(bucket, entry) {
  if (entry.type !== 'file') {
    return [{ label: 'Folder URL', value: `${window.location.origin}/${bucket.label}/${entry.key}` }]
  }
  const url = fileUrl(bucket, entry.key)
  return [
    { label: 'HTTPS URL', value: url },
    { label: 'S3 URI', value: s3Uri(bucket, entry.key) },
    { label: 'GDAL /vsicurl/', value: `/vsicurl/${url}` },
  ]
}

export default function EntryList({
  bucket, entries, view, sort, onSort, onOpen, cursor, onCursor, showFullKey, footer,
}) {
  const scroller = useRef(null)
  const [box, onScroll] = useViewport(scroller)

  const cols = view === 'grid'
    ? Math.max(1, Math.floor((box.width - 24) / GRID_MIN_W))
    : 1
  const unitH = view === 'grid' ? GRID_H : ROW_H
  const lines = view === 'grid' ? Math.ceil(entries.length / cols) : entries.length
  const total = lines * unitH

  const first = Math.max(0, Math.floor(box.top / unitH) - OVERSCAN)
  const last = Math.min(lines, Math.ceil((box.top + box.height) / unitH) + OVERSCAN)
  const slice = entries.slice(first * cols, last * cols)

  // Keep the keyboard cursor inside the viewport.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || cursor == null || cursor < 0) return
    const line = view === 'grid' ? Math.floor(cursor / cols) : cursor
    const top = line * unitH
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + unitH > el.scrollTop + el.clientHeight) el.scrollTop = top + unitH - el.clientHeight
  }, [cursor, cols, unitH, view])

  const renderEntry = (entry, index) => {
    const active = index === cursor
    const isUp = entry.type === 'up'
    const isDir = entry.type === 'dir'
    const { label: kind } = isDir || isUp ? { label: 'Folder' } : typeOf(entry.name)
    const display = decodeSafe(entry.name)

    const common = {
      className: `entry${active ? ' is-active' : ''}${isUp ? ' is-up' : ''}`,
      onClick: e => {
        // Let modified clicks (new tab, download) behave natively.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onCursor?.(index)
        onOpen(entry)
      },
      href: isUp ? `/${bucket.label}/${encodeKey(entry.key)}` : entryHref(bucket, entry),
      title: isUp ? 'Parent folder' : decodeSafe(entry.key),
    }

    const icon = isUp ? <UpIcon className="ico" />
      : isDir ? <FolderIcon className="ico ico-dir" />
        : <FileIcon className="ico ico-file" />

    if (view === 'grid') {
      return (
        <a key={entry.key + entry.type} {...common} className={`${common.className} cell`}>
          <span className="cell-icon">{icon}</span>
          <span className="cell-name" title={display}>{display}</span>
          <span className="cell-meta">
            {isUp ? '' : isDir ? 'Folder' : `${kind} · ${humanSize(entry.size)}`}
          </span>
        </a>
      )
    }

    return (
      <div key={entry.key + entry.type} className={`row${active ? ' is-active' : ''}`}>
        <a {...common}>
          {icon}
          <EntryName text={display} splitPath={showFullKey} />
        </a>
        <span className="col-kind">{isUp ? '' : kind}</span>
        <span className="col-size">{isUp || isDir ? '' : humanSize(entry.size)}</span>
        <span className="col-date" title={entry.modified ? exactDate(entry.modified) : ''}>
          {isUp || isDir ? '' : humanDate(entry.modified)}
        </span>
        <span className="col-act">
          {!isUp && <CopyMenu items={copyItems(bucket, entry)} compact title="Copy link" />}
        </span>
      </div>
    )
  }

  return (
    <div className="entries">
      {view === 'list' && (
        <div className="row row-head" role="row">
          {SORTS.map(col => (
            <button
              key={col.key}
              className={`sort-btn ${col.className || 'col-name'}${sort.by === col.key ? ' is-sorted' : ''}`}
              onClick={() => onSort(col.key)}
              aria-sort={sort.by === col.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
            >
              {col.label}
              <span className="arr">{sort.by === col.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
            </button>
          ))}
          <span className="col-act" />
        </div>
      )}

      <div className="scroller" ref={scroller} onScroll={onScroll} tabIndex={-1}>
        <div className={view === 'grid' ? 'grid-body' : 'list-body'} style={{ height: total }}>
          <div
            className={view === 'grid' ? 'window window-grid' : 'window'}
            style={{
              transform: `translateY(${first * unitH}px)`,
              ...(view === 'grid' ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : null),
            }}
          >
            {slice.map((entry, i) => renderEntry(entry, first * cols + i))}
          </div>
        </div>
        {footer}
      </div>
    </div>
  )
}
