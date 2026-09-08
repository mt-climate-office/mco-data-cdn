import { humanSize, pluralize } from '../lib/format.js'
import { SearchIcon, ListIcon, GridIcon, CloseIcon, SpinnerIcon } from './Icons.jsx'

export default function Toolbar({
  query, onQuery, inputRef,
  recursive, onRecursive,
  view, onView,
  stats, scan, actions,
}) {
  const { folders, files, bytes, shown, total } = stats
  const summary = [
    folders ? pluralize(folders, 'folder') : '',
    files ? pluralize(files, 'file') : '',
    bytes ? humanSize(bytes) : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="toolbar">
      <div className="search">
        <SearchIcon className="search-ico" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={recursive ? 'Search all subfolders…' : 'Filter this folder…'}
          aria-label={recursive ? 'Search all subfolders' : 'Filter this folder'}
          onChange={e => onQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => onQuery('')} aria-label="Clear filter">
            <CloseIcon />
          </button>
        )}
      </div>

      <label className="toggle" title="Walk every prefix below this folder">
        <input type="checkbox" checked={recursive} onChange={e => onRecursive(e.target.checked)} />
        <span>Search subfolders</span>
      </label>

      <div className="toolbar-spacer" />

      <span className="stats">
        {scan?.active
          ? <><SpinnerIcon className="stats-spin" /> scanned {scan.scanned.toLocaleString()}…</>
          : query
            ? `${shown.toLocaleString()} of ${total.toLocaleString()} shown`
            : (summary || 'empty')}
      </span>

      {scan?.active && (
        <button className="btn btn-quiet" onClick={scan.onCancel}>Stop</button>
      )}

      {actions}

      <div className="view-toggle" role="group" aria-label="View mode">
        <button
          className={`btn icon-btn${view === 'list' ? ' is-on' : ''}`}
          onClick={() => onView('list')} aria-pressed={view === 'list'} title="List view">
          <ListIcon />
        </button>
        <button
          className={`btn icon-btn${view === 'grid' ? ' is-on' : ''}`}
          onClick={() => onView('grid')} aria-pressed={view === 'grid'} title="Grid view">
          <GridIcon />
        </button>
      </div>
    </div>
  )
}
