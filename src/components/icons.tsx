// 自前 SVG アイコン（依存追加なし。UI-2）。
// lucide (https://lucide.dev, ISC License) を参考にした簡素な自作パス。
// stroke ベースで currentColor に追従するため、ボタンのホバー色にそのまま馴染む。
import type { ReactNode } from 'react'

export type IconName =
  | 'more-horizontal'
  | 'scroll-text'
  | 'bar-chart-3'
  | 'book-open'
  | 'image'
  | 'git-branch'
  | 'hourglass'
  | 'palette'
  | 'mountain'
  | 'credit-card'
  | 'layers'
  | 'settings'
  | 'trash-2'
  | 'x'
  | 'pencil'
  | 'check'
  | 'fast-forward'
  | 'play'
  | 'rotate-ccw'
  | 'corner-down-right'
  | 'refresh-cw'
  | 'message-circle'
  | 'library-big'
  | 'archive'
  | 'plus'
  | 'download'
  | 'upload'
  | 'square'
  | 'star'
  | 'corner-up-left'
  | 'scissors'
  | 'users'
  | 'globe'
  | 'smile'
  | 'clapperboard'
  | 'broom'
  | 'arrow-up'
  | 'maximize'
  | 'chevron-right'
  | 'chevron-down'
  | 'flag'
  | 'trophy'
  | 'lock'
  | 'dice'
  | 'sparkles'
  | 'folder'
  | 'gamepad'
  | 'alert-triangle'
  | 'panel-right'
  | 'volume-2'

const PATHS: Record<IconName, ReactNode> = {
  'more-horizontal': (
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  'scroll-text': (
    <>
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <line x1="8" y1="12" x2="15" y2="12" />
      <line x1="8" y1="16" x2="15" y2="16" />
    </>
  ),
  'bar-chart-3': (
    <>
      <rect x="3" y="12" width="4" height="8" rx="1" fill="currentColor" stroke="none" />
      <rect x="10" y="6" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="17" y="9" width="4" height="11" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  'book-open': (
    <>
      <path d="M12 6c-1.5-1.3-3.5-2-6-2H3v14h3c2.5 0 4.5.7 6 2 1.5-1.3 3.5-2 6-2h3V4h-3c-2.5 0-4.5.7-6 2z" />
      <line x1="12" y1="6" x2="12" y2="20" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" fill="currentColor" stroke="none" />
      <path d="M21 16l-5-5-4 4-2-2-6 6" />
    </>
  ),
  'git-branch': (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <path d="M6 8.2V16" />
      <path d="M6 11c0 3 3 5 6 5h3.8" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M7 3c0 5 3 6 5 8-2 2-5 3-5 8" />
      <path d="M17 3c0 5-3 6-5 8 2 2 5 3 5 8" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8h2.1A4.3 4.3 0 0 0 21 10.7 8.4 8.4 0 0 0 12 3z" />
      <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  mountain: <path d="M3 20 9 8l4 6 3-4 5 10" />,
  'credit-card': (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </>
  ),
  layers: (
    <>
      <path d="M12 2 2 7l10 5 10-5z" />
      <path d="M2 12l10 5 10-5" />
      <path d="M2 17l10 5 10-5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  'trash-2': (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  'fast-forward': (
    <>
      <path d="M5 4l8 8-8 8z" fill="currentColor" stroke="none" />
      <path d="M13 4l8 8-8 8z" fill="currentColor" stroke="none" />
    </>
  ),
  play: <path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" />,
  'rotate-ccw': (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </>
  ),
  'corner-down-right': (
    <>
      <path d="M5 3v8a4 4 0 0 0 4 4h10" />
      <path d="M15 11l4 4-4 4" />
    </>
  ),
  'refresh-cw': (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  'message-circle': <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.7-.3-3.9-.9L3 21l1.4-5.6A8.5 8.5 0 1 1 21 12z" />,
  'library-big': (
    <>
      <rect x="3" y="4" width="6" height="16" rx="1" />
      <rect x="11" y="4" width="6" height="16" rx="1" />
      <path d="M19.5 5.5 22 19a1 1 0 0 1-.8 1.2L19 20.5" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 21h14" />
    </>
  ),
  square: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  star: (
    <path d="M12 2.5l2.9 6.6 7.1.7-5.4 4.9 1.6 7-6.2-3.7-6.2 3.7 1.6-7-5.4-4.9 7.1-.7z" />
  ),
  'corner-up-left': (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="8.5" y1="8.5" x2="19" y2="19" />
      <line x1="8.5" y1="15.5" x2="19" y2="5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M15.2 20c.2-2.2 1.6-3.9 3.6-4.4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3 3 3 15 0 18" />
      <path d="M12 3c-3 3-3 15 0 18" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  clapperboard: (
    <>
      <path d="M3 8l1.3-3.6h3.9L7 8z" />
      <path d="M7 8l1.3-3.6h3.9L11 8z" />
      <path d="M11 8l1.3-3.6h3.9L15 8z" />
      <path d="M15 8l1.3-3.6H20L18.7 8z" />
      <rect x="3" y="8" width="18" height="12" rx="1" />
    </>
  ),
  broom: (
    <>
      <path d="M20 4 10.5 13.5" />
      <path d="M10.5 13.5c-1.5.7-2.2 2.6-1.5 4.5" />
      <path d="M10.5 13.5c-3-.3-5.3.6-6.5 3" />
      <path d="M4 20l2.5-3" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </>
  ),
  maximize: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </>
  ),
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4c4-2 6 2 10 0v9c-4 2-6-2-10 0" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4a3 3 0 0 0 3.2 4" />
      <path d="M17 6h3a3 3 0 0 1-3.2 4" />
      <path d="M12 14v4" />
      <path d="M8 21h8" />
      <path d="M9 21c0-2 1.2-3 3-3s3 1 3 3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11 4l1.6 4.4L17 10l-4.4 1.6L11 16l-1.6-4.4L5 10l4.4-1.6z" />
      <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
    </>
  ),
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  gamepad: (
    <>
      <path d="M7 6h10a4 4 0 0 1 4 4v4a3.5 3.5 0 0 1-6.3 2.1L13.5 14h-3l-1.2 2.1A3.5 3.5 0 0 1 3 14v-4a4 4 0 0 1 4-4z" />
      <path d="M7 10v3M5.5 11.5h3" />
      <circle cx="16" cy="12.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M12 3 2.5 20h19z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'panel-right': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </>
  ),
  'volume-2': (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
}

export function Icon({
  name,
  size = 16,
  className,
  filled,
}: {
  name: IconName
  size?: number
  className?: string
  /** true でアウトラインでなく塗りつぶし表示にする（例: ☆→★のしおりトグル） */
  filled?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}
