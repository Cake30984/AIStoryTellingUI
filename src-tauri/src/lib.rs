// R3: API キーを OS の資格情報ストアへ分離する（平文 state.json に置かない）。
// service 名はアプリの identifier（tauri.conf.json）に固定し、id（"provider:<uuid>" 等。
// platform.ts の PROVIDER_SECRET_PREFIX / IMAGE_PROVIDER_SECRET_PREFIX）を account 名に使う。
const SECRET_SERVICE: &str = "com.tokatokage.delist";

#[tauri::command]
fn save_secret(id: String, value: String) -> Result<(), String> {
  let entry = keyring::Entry::new(SECRET_SERVICE, &id).map_err(|e| e.to_string())?;
  entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_secret(id: String) -> Result<Option<String>, String> {
  let entry = keyring::Entry::new(SECRET_SERVICE, &id).map_err(|e| e.to_string())?;
  match entry.get_password() {
    Ok(v) => Ok(Some(v)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
fn delete_secret(id: String) -> Result<(), String> {
  let entry = keyring::Entry::new(SECRET_SERVICE, &id).map_err(|e| e.to_string())?;
  match entry.delete_credential() {
    Ok(()) => Ok(()),
    Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![save_secret, load_secret, delete_secret])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
