// ---------------------------------------------------------------------------
// Human formatting + file-type classification.
// ---------------------------------------------------------------------------

export function humanSize(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const ABSOLUTE = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
})
const EXACT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
})

const STEPS = [
  ['year', 365 * 24 * 3600e3],
  ['month', 30 * 24 * 3600e3],
  ['week', 7 * 24 * 3600e3],
  ['day', 24 * 3600e3],
  ['hour', 3600e3],
  ['minute', 60e3],
]

// "3 days ago" for anything recent, a plain date for the archive's older half —
// relative time stops being useful once it reads "2 years ago".
export function humanDate(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = t - Date.now()
  const abs = Math.abs(diff)
  if (abs > 90 * 24 * 3600e3) return ABSOLUTE.format(t)
  for (const [unit, ms] of STEPS) {
    if (abs >= ms) return RELATIVE.format(Math.round(diff / ms), unit)
  }
  return RELATIVE.format(Math.round(diff / 1000), 'second')
}

export function exactDate(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '' : EXACT.format(t)
}

export function extOf(name) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

// category drives the icon colour and how the entry opens.
const TYPES = {
  tif: ['GeoTIFF', 'raster'], tiff: ['GeoTIFF', 'raster'],
  nc: ['NetCDF', 'raster'], nc4: ['NetCDF', 'raster'], grib: ['GRIB', 'raster'],
  hdf: ['HDF', 'raster'], h5: ['HDF5', 'raster'], zarr: ['Zarr', 'raster'],
  vrt: ['GDAL VRT', 'raster'],

  parquet: ['Parquet', 'table'], pq: ['Parquet', 'table'],
  csv: ['CSV', 'table'], tsv: ['TSV', 'table'], arrow: ['Arrow', 'table'],
  fgb: ['FlatGeobuf', 'vector'], gpkg: ['GeoPackage', 'vector'],
  shp: ['Shapefile', 'vector'], geojson: ['GeoJSON', 'vector'],
  topojson: ['TopoJSON', 'vector'], pmtiles: ['PMTiles', 'vector'],

  json: ['JSON', 'text'], xml: ['XML', 'text'], yml: ['YAML', 'text'],
  yaml: ['YAML', 'text'], txt: ['Text', 'text'], log: ['Log', 'text'],
  md: ['Markdown', 'text'], sql: ['SQL', 'text'], cff: ['Citation', 'text'],
  bib: ['BibTeX', 'text'], r: ['R', 'text'], py: ['Python', 'text'],
  sh: ['Shell', 'text'], html: ['HTML', 'text'],

  png: ['PNG', 'image'], jpg: ['JPEG', 'image'], jpeg: ['JPEG', 'image'],
  gif: ['GIF', 'image'], webp: ['WebP', 'image'], svg: ['SVG', 'image'],
  avif: ['AVIF', 'image'],

  pdf: ['PDF', 'doc'],
  zip: ['ZIP', 'archive'], tar: ['TAR', 'archive'], gz: ['GZIP', 'archive'],
  bz2: ['BZIP2', 'archive'], xz: ['XZ', 'archive'], zst: ['Zstandard', 'archive'],
}

export function typeOf(name) {
  const ext = extOf(name)
  const [label, category] = TYPES[ext] || [ext ? ext.toUpperCase() : 'File', 'other']
  return { ext, label, category }
}

// How a click on the entry should behave.
export const TEXT_PREVIEW = new Set([
  'txt', 'csv', 'tsv', 'json', 'geojson', 'topojson', 'xml', 'md', 'yml',
  'yaml', 'log', 'cff', 'bib', 'sql', 'r', 'py', 'sh', 'vrt',
])
export const IMAGE_PREVIEW = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'])
export const NATIVE_VIEW = new Set(['pdf', 'html', 'mp4', 'webm'])

export function pluralize(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
}

// Natural sort: file_2 before file_10, and date-stamped names stay in order.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export function compareNames(a, b) {
  return collator.compare(a, b)
}
