import { useEffect, useRef, useState } from 'react'
import { CopyIcon, CheckIcon } from './Icons.jsx'

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API needs a secure context; fall back to a selectable prompt.
    window.prompt('Copy this:', text)
    return false
  }
}

// A "Copy" button that opens a menu of link forms (HTTPS, s3://, /vsicurl/).
// With a single item it copies straight away.
export default function CopyMenu({ items, compact = false, title = 'Copy link' }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useEffect(() => {
    if (copied == null) return
    const t = setTimeout(() => setCopied(null), 1400)
    return () => clearTimeout(t)
  }, [copied])

  const run = async (item) => {
    await copyText(item.value)
    setCopied(item.label)
    setOpen(false)
  }

  const single = items.length === 1

  return (
    <span className="copy-menu" ref={ref}>
      <button
        className={`btn ${compact ? 'btn-quiet' : ''} ${copied ? 'btn-done' : ''}`}
        title={title}
        aria-label={title}
        aria-haspopup={single ? undefined : 'menu'}
        aria-expanded={single ? undefined : open}
        onClick={e => {
          e.stopPropagation()
          if (single) run(items[0])
          else setOpen(o => !o)
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {!compact && <span>{copied ? 'Copied' : 'Copy'}</span>}
      </button>

      {open && !single && (
        <div className="copy-pop" role="menu">
          {items.map(item => (
            <button key={item.label} role="menuitem" className="copy-pop-item"
              onClick={e => { e.stopPropagation(); run(item) }}>
              <span className="copy-pop-label">{item.label}</span>
              <span className="copy-pop-value">{item.value}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
