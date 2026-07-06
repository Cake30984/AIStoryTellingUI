// チェックポイント（セーブ/ロード・分岐周回）用の gzip 圧縮ヘルパ。
// CompressionStream/DecompressionStream は Chromium 系（Web 版・Tauri の WebView2 とも）で利用可能。

async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.length
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/** 文字列を gzip 圧縮した Uint8Array にする */
export async function gzipText(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  void writer.write(bytes).then(() => writer.close())
  return streamToUint8Array(cs.readable)
}

/** gzip 圧縮された Uint8Array を文字列に戻す */
export async function gunzipText(data: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  void writer.write(data as BufferSource).then(() => writer.close())
  const bytes = await streamToUint8Array(ds.readable)
  return new TextDecoder().decode(bytes)
}
