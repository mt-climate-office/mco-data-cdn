// ---------------------------------------------------------------------------
// S3 REST listing + URL construction.
//
// Public origin buckets are listed straight from the S3 REST endpoint (always
// fresh, and their CORS rule allows this site's origin). The private origin
// (mesonet) has no public S3 endpoint, so its listings go through the CDN,
// which forwards ?list-type=2 to S3 over OAC. Both cases are just a host in
// the bucket's `domain` config; `listEndpoint` is the only place that knows.
// ---------------------------------------------------------------------------

const DEV = import.meta.env.DEV

// Where file links point. In dev the app is on localhost, so downloads and
// previews need the real CDN.
export const CDN_BASE = (import.meta.env.VITE_CDN_BASE || '').replace(/\/$/, '') ||
  (DEV ? 'https://data2.climate.umt.edu' : window.location.origin)

// In dev, listings go through the Vite proxy (see vite.config.js) because the
// buckets' CORS rules only allow the production origins.
function listEndpoint(bucket) {
  return DEV ? `/__s3/${bucket.label}` : `https://${bucket.domain}`
}

// S3 keys may hold literal spaces and percent signs; "/" and "=" stay literal
// so partitioned (hive-style) paths remain readable in the address bar.
export function encodeKey(key) {
  return key
    .replaceAll('%', '%25')
    .replaceAll(' ', '%20')
    .replaceAll('#', '%23')
    .replaceAll('?', '%3F')
    .replaceAll('+', '%2B')
}

export function decodeSafe(s) {
  try {
    return decodeURIComponent(s.replaceAll('+', '%2B'))
  } catch {
    return s
  }
}

// Public HTTPS URL for an object, served by the CDN.
export function fileUrl(bucket, key) {
  return `${CDN_BASE}/${bucket.label}/${encodeKey(key)}`
}

// s3:// URI — what rasterio/GDAL/DuckDB users want to paste.
export function s3Uri(bucket, key) {
  return `s3://${bucket.bucket}/${key}`
}

// GDAL virtual filesystem path for the HTTPS URL (COGs, remote Parquet).
export function vsicurlUri(bucket, key) {
  return `/vsicurl/${fileUrl(bucket, key)}`
}

function textOf(parent, tag) {
  const el = parent.getElementsByTagName(tag)[0]
  return el ? el.textContent : ''
}

export class ListError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ListError'
    this.status = status
  }
}

// One page of ListObjectsV2. `delimiter: ''` walks the whole subtree.
async function listPage(bucket, { prefix = '', delimiter = '/', token, signal } = {}) {
  const params = new URLSearchParams({ 'list-type': '2' })
  if (delimiter) params.set('delimiter', delimiter)
  if (prefix) params.set('prefix', prefix)
  if (token) params.set('continuation-token', token)

  let res
  try {
    res = await fetch(`${listEndpoint(bucket)}/?${params}`, { signal })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ListError(`couldn't reach the archive (${err.message})`)
  }
  if (res.status === 403) {
    throw new ListError("this folder isn't listable — its files are shared by direct link only", 403)
  }
  if (!res.ok) {
    throw new ListError(`the archive returned HTTP ${res.status}`, res.status)
  }

  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml')
  if (xml.getElementsByTagName('parsererror').length) {
    throw new ListError('the archive returned a malformed listing')
  }

  const dirs = [...xml.getElementsByTagName('CommonPrefixes')]
    .map(el => textOf(el, 'Prefix'))
    .filter(Boolean)

  const files = [...xml.getElementsByTagName('Contents')]
    .map(el => ({
      key: textOf(el, 'Key'),
      size: Number(textOf(el, 'Size')) || 0,
      modified: textOf(el, 'LastModified'),
    }))
    // S3 reports the prefix placeholder object (a zero-byte "folder" marker)
    // as a member of its own listing; it isn't a file.
    .filter(f => f.key && f.key !== prefix)

  return {
    dirs,
    files,
    truncated: textOf(xml, 'IsTruncated') === 'true',
    token: textOf(xml, 'NextContinuationToken') || null,
  }
}

// Page through a listing, handing each page to `onPage` as it lands so the UI
// can render incrementally. Stops at `maxPages` (the snodas COG tree is deep
// enough that an unbounded walk would hammer S3).
export async function listAll(bucket, { prefix = '', delimiter = '/', signal, onPage, maxPages = 50 } = {}) {
  let token = null
  for (let page = 0; page < maxPages; page++) {
    const result = await listPage(bucket, { prefix, delimiter, token, signal })
    onPage?.(result, page)
    if (!result.truncated || !result.token) return { truncated: false, pages: page + 1 }
    token = result.token
  }
  return { truncated: true, pages: maxPages }
}
