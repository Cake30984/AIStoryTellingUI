// R4: OpenRouter OAuth (PKCE) のローカル受け口。
//
// OpenRouter の `https://openrouter.ai/auth` は `state` パラメータを持たない（公式ドキュメント
// 確認済み・2026-08-16）。CSRF 対策は代わりに、この受け口を「1回きり・ランダムな nonce を
// パスに含む URL でしか受け付けない」ことで代替する（callback_url に nonce を埋め込み、
// OpenRouter はそこへ `?code=...` を付け足して redirect するだけなので両立する）。
//
// 受け口は 127.0.0.1 の OS 割当ポートに限定し、リクエストを1件受けたら即座に閉じる。

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct OAuthPortEvent {
  pub port: u16,
}

#[derive(Serialize)]
pub struct OAuthCallbackResult {
  pub code: Option<String>,
  pub error: Option<String>,
}

const RESPONSE_OK: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n\
  <!doctype html><meta charset=\"utf-8\"><title>デリスト</title>\
  <body style=\"font-family:sans-serif;text-align:center;padding:48px\">\
  <p>アプリに戻ってください。このタブは閉じて構いません。</p></body>";

const RESPONSE_BAD: &str = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\nbad request";

/// クエリ文字列 `a=1&b=2` から key の値を取り出す（URL デコードは `%XX` と `+` のみ対応。
/// OAuth の code/error は英数字・記号少数のため簡易実装で足りる）。
fn query_param(query: &str, key: &str) -> Option<String> {
  query.split('&').find_map(|pair| {
    let mut it = pair.splitn(2, '=');
    let k = it.next()?;
    let v = it.next().unwrap_or("");
    if k != key {
      return None;
    }
    Some(url_decode(v))
  })
}

fn url_decode(s: &str) -> String {
  let bytes = s.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    match bytes[i] {
      b'+' => {
        out.push(b' ');
        i += 1;
      }
      b'%' if i + 2 < bytes.len() => {
        if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
          out.push(byte);
          i += 3;
        } else {
          out.push(bytes[i]);
          i += 1;
        }
      }
      b => {
        out.push(b);
        i += 1;
      }
    }
  }
  String::from_utf8_lossy(&out).into_owned()
}

/// リクエストライン（例: `GET /callback/abc123?code=xyz HTTP/1.1`）から
/// パスが `expected_path_prefix` と一致するかを見て、一致すれば query 文字列を返す。
fn parse_request_line(line: &str, expected_path_prefix: &str) -> Option<String> {
  let mut parts = line.split_whitespace();
  let method = parts.next()?;
  let target = parts.next()?;
  if method != "GET" {
    return None;
  }
  let (path, query) = match target.split_once('?') {
    Some((p, q)) => (p, q),
    None => (target, ""),
  };
  if path != expected_path_prefix {
    return None;
  }
  Some(query.to_string())
}

fn handle_connection(mut stream: TcpStream, expected_path: &str) -> Option<OAuthCallbackResult> {
  stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
  let mut reader = BufReader::new(stream.try_clone().ok()?);
  let mut request_line = String::new();
  reader.read_line(&mut request_line).ok()?;

  let query = parse_request_line(request_line.trim_end(), expected_path);
  let query = match query {
    Some(q) => q,
    None => {
      let _ = stream.write_all(RESPONSE_BAD.as_bytes());
      return None;
    }
  };

  let code = query_param(&query, "code");
  let error = query_param(&query, "error");
  let _ = stream.write_all(RESPONSE_OK.as_bytes());
  let _ = stream.flush();
  Some(OAuthCallbackResult { code, error })
}

fn accept_with_timeout(listener: &TcpListener, timeout: Duration) -> std::io::Result<Option<TcpStream>> {
  listener.set_nonblocking(true)?;
  let start = Instant::now();
  loop {
    match listener.accept() {
      Ok((stream, _)) => return Ok(Some(stream)),
      Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
        if start.elapsed() >= timeout {
          return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(100));
      }
      Err(e) => return Err(e),
    }
  }
}

/// ポートを確保して JS へ通知したのち、コールバックを1件だけ待って結果を返す。
/// nonce はパス（`/callback/<nonce>`）に埋め込み、一致しないリクエストは無視する
/// （ブラウザのプリフェッチ・他プロセスからの誤接続対策）。
#[tauri::command]
pub async fn oauth_pkce_listen(
  app: AppHandle,
  nonce: String,
  timeout_secs: u64,
) -> Result<OAuthCallbackResult, String> {
  let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
  let port = listener.local_addr().map_err(|e| e.to_string())?.port();

  app
    .emit("oauth-pkce-port", OAuthPortEvent { port })
    .map_err(|e| e.to_string())?;

  let expected_path = format!("/callback/{nonce}");
  let deadline = Instant::now() + Duration::from_secs(timeout_secs);

  tauri::async_runtime::spawn_blocking(move || -> Result<OAuthCallbackResult, String> {
    loop {
      let remaining = deadline.saturating_duration_since(Instant::now());
      if remaining.is_zero() {
        return Ok(OAuthCallbackResult {
          code: None,
          error: Some("timeout".to_string()),
        });
      }
      let stream = accept_with_timeout(&listener, remaining).map_err(|e| e.to_string())?;
      let stream = match stream {
        Some(s) => s,
        None => {
          return Ok(OAuthCallbackResult {
            code: None,
            error: Some("timeout".to_string()),
          })
        }
      };
      // nonce と一致しないリクエスト（プリフェッチ等）は無視して待ち続ける（残り時間内で）
      if let Some(result) = handle_connection(stream, &expected_path) {
        return Ok(result);
      }
    }
  })
  .await
  .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_code_from_matching_path() {
    let query = parse_request_line("GET /callback/abc123?code=xyz&foo=bar HTTP/1.1", "/callback/abc123").unwrap();
    assert_eq!(query_param(&query, "code"), Some("xyz".to_string()));
  }

  #[test]
  fn rejects_mismatched_nonce_path() {
    assert!(parse_request_line("GET /callback/wrong?code=xyz HTTP/1.1", "/callback/abc123").is_none());
  }

  #[test]
  fn rejects_non_get_method() {
    assert!(parse_request_line("POST /callback/abc123?code=xyz HTTP/1.1", "/callback/abc123").is_none());
  }

  #[test]
  fn extracts_error_param() {
    let query = parse_request_line("GET /callback/n?error=access_denied HTTP/1.1", "/callback/n").unwrap();
    assert_eq!(query_param(&query, "error"), Some("access_denied".to_string()));
    assert_eq!(query_param(&query, "code"), None);
  }

  #[test]
  fn url_decode_handles_percent_and_plus() {
    assert_eq!(url_decode("a%20b+c"), "a b c");
    assert_eq!(url_decode("100%25"), "100%");
  }

  #[test]
  fn handles_path_without_query() {
    let query = parse_request_line("GET /callback/abc123 HTTP/1.1", "/callback/abc123").unwrap();
    assert_eq!(query, "");
    assert_eq!(query_param(&query, "code"), None);
  }
}
