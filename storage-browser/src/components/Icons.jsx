// Inline SVG icons. Sized by CSS (currentColor everywhere).

export const FolderIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2c.4 0 .78.16 1.06.44L8.5 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-8Z" />
  </svg>
)

export const FileIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
    strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M4 1.75h5.2L12.5 5v9.25h-8.5V1.75Z" />
    <path d="M9 1.75V5h3.5" />
  </svg>
)

export const UpIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M8 12.5V4M4.5 7.5 8 4l3.5 3.5" />
  </svg>
)

export const SearchIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" aria-hidden="true" {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.2 10.2 3 3" />
  </svg>
)

export const ListIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" aria-hidden="true" {...props}>
    <path d="M2 4h12M2 8h12M2 12h12" />
  </svg>
)

export const GridIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
)

export const CopyIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
    strokeLinejoin="round" aria-hidden="true" {...props}>
    <rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.5" />
    <path d="M10.25 3.75a1.5 1.5 0 0 0-1.5-1.5h-5a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1.5 1.5" />
  </svg>
)

export const CheckIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="m3.5 8.5 3 3 6-6.5" />
  </svg>
)

export const CloseIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" aria-hidden="true" {...props}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
)

export const SunIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
)

export const MoonIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

export const SpinnerIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" className="spin" aria-hidden="true" {...props}>
    <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" />
  </svg>
)
