// ---------------------------------------------------------------------------
// A small Markdown renderer for READMEs and .md previews.
//
// Escaping happens first and unconditionally, so the only HTML in the output
// is the tags this file emits — raw HTML in the source document is shown as
// literal text rather than rendered. That keeps bucket content (which any
// data pipeline with write access could change) from injecting markup.
// ---------------------------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = s => String(s).replace(/[&<>"']/g, c => ESCAPES[c])

// Only schemes that can't execute script.
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#|\.{0,2}\/)/i
const href = url => (SAFE_HREF.test(url.trim()) ? esc(url.trim()) : null)

// Inline code is pulled out before emphasis runs, then restored. The sentinel
// survives the intervening replaces; a document that contains the sentinel
// literally can only ever swap in one of our own (already escaped) spans.
const HOLD = (i) => `\x01CODE${i}\x01`

function inline(text) {
  let out = esc(text)
  const code = []
  out = out.replace(/`([^`]+)`/g, (_, body) => {
    code.push(`<code>${body}</code>`)
    return HOLD(code.length - 1)
  })
  out = out
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => {
      const safe = href(url)
      return safe ? `<img src="${safe}" alt="${alt}" loading="lazy">` : alt
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label, url) => {
      const safe = href(url)
      return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return out.replace(/\x01CODE(\d+)\x01/g, (_, i) => code[Number(i)])
}

const tableRow = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

export function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n')
  const html = []
  let list = null // 'ul' | 'ol'

  const closeList = () => {
    if (list) { html.push(`</${list}>`); list = null }
  }
  const openList = kind => {
    if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Fenced code block.
    if (/^\s*```+/.test(line)) {
      closeList()
      const body = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      html.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`)
      continue
    }

    if (!line.trim()) { closeList(); continue }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`)
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[-*_\s]*$/.test(line)) {
      closeList()
      html.push('<hr>')
      continue
    }

    // Table: a header row followed by a |---|---| separator.
    if (line.trim().startsWith('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) {
      closeList()
      const head = tableRow(line)
      i += 2
      const body = []
      while (i < lines.length && lines[i].trim().startsWith('|')) body.push(tableRow(lines[i++]))
      i--
      html.push(
        '<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>'
      )
      continue
    }

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      closeList()
      html.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      continue
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    if (bullet) {
      openList('ul')
      html.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (numbered) {
      openList('ol')
      html.push(`<li>${inline(numbered[1])}</li>`)
      continue
    }

    // Paragraph: absorb following lines until a blank line or a new block.
    closeList()
    const para = [line]
    while (
      i + 1 < lines.length && lines[i + 1].trim() &&
      !/^\s*(#{1,6}\s|```|>|[-*+]\s|\d+[.)]\s|\|)/.test(lines[i + 1])
    ) para.push(lines[++i])
    html.push(`<p>${inline(para.join(' '))}</p>`)
  }

  closeList()
  return html.join('\n')
}
