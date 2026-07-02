import { useState } from 'react'

/** PNG カードのドラッグ&ドロップ受付。ライブラリ一覧のコンテナに dropProps をスプレッドして使う */
export function useCardDrop(onFiles: (files: FileList) => void) {
  const [dragOver, setDragOver] = useState(false)

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(true)
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files)
    },
  }

  return { dragOver, dropProps }
}
