import type { ReactNode } from 'react'

/**
 * 長い説明文の折りたたみ（FB8-E1）。
 * 見出し直下には要点1文だけを `.desc` で置き、残りの詳しい説明を本コンポーネントに入れる。
 * ネイティブ `<details>` なので状態管理・依存なし。
 */
export default function HelpDetails({ summary = '詳しい説明', children }: { summary?: string; children: ReactNode }) {
  return (
    <details className="help-details">
      <summary>{summary}</summary>
      <div className="help-details-body">{children}</div>
    </details>
  )
}
