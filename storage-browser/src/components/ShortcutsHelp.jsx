import { useEffect } from 'react'
import { CloseIcon } from './Icons.jsx'

const KEYS = [
  ['/ or f', 'Focus the filter box'],
  ['j / k', 'Move down / up'],
  ['Enter', 'Open the highlighted entry'],
  ['u or Backspace', 'Go to the parent folder'],
  ['g / G', 'Jump to the top / bottom'],
  ['v', 'Toggle list and grid view'],
  ['r', 'Toggle searching subfolders'],
  ['Esc', 'Clear the filter, or close a preview'],
  ['? ', 'Show this help'],
]

const PREVIEW_KEYS = [
  ['Left / Right', 'Previous / next previewable file'],
  ['Esc', 'Close the preview'],
]

export default function ShortcutsHelp({ onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="preview-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="preview-panel help-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <header className="preview-head">
          <div className="preview-title"><span className="preview-name">Keyboard shortcuts</span></div>
          <button className="btn icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>
        <div className="preview-content help-content">
          <dl className="shortcuts">
            {KEYS.map(([key, what]) => (
              <div key={key}><dt><kbd>{key.trim()}</kbd></dt><dd>{what}</dd></div>
            ))}
          </dl>
          <h3>In a preview</h3>
          <dl className="shortcuts">
            {PREVIEW_KEYS.map(([key, what]) => (
              <div key={key}><dt><kbd>{key}</kbd></dt><dd>{what}</dd></div>
            ))}
          </dl>
          <p className="note">
            Every view is linkable: the folder is the URL path, and the filter, sort
            order, view mode, and subfolder search ride in the query string.
          </p>
        </div>
      </div>
    </div>
  )
}
