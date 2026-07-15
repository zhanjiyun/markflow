use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use tauri::Emitter;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    endpoint: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatResponse {
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeepSeekResponse {
    choices: Option<Vec<DeepSeekChoice>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeepSeekChoice {
    message: Option<DeepSeekMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeepSeekMessage {
    content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeepSeekError {
    error: Option<DeepSeekErrorBody>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeepSeekErrorBody {
    message: Option<String>,
}

#[tauri::command]
async fn chat_with_ai(request: ChatRequest) -> Result<ChatResponse, String> {
    let mut endpoint = request.endpoint.trim().to_string();
    if endpoint.is_empty() || !endpoint.starts_with("http") {
        return Err(format!("Invalid API endpoint: {}", endpoint));
    }

    if !endpoint.ends_with("/chat/completions") {
        endpoint = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let body = serde_json::json!({
        "model": request.model.trim(),
        "messages": request.messages.iter().map(|message| {
            serde_json::json!({
                "role": message.role,
                "content": message.content,
            })
        }).collect::<Vec<_>>(),
        "stream": false,
    });

    let response = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .header(
            "Authorization",
            format!("Bearer {}", request.api_key.trim()),
        )
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();

    if !status.is_success() {
        let err_body = response
            .json::<DeepSeekError>()
            .await
            .unwrap_or(DeepSeekError { error: None });
        let message = err_body
            .error
            .and_then(|error| error.message)
            .unwrap_or_else(|| format!("HTTP {}", status));
        return Err(message);
    }

    let data = response
        .json::<DeepSeekResponse>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let content = data
        .choices
        .and_then(|choices| choices.into_iter().next())
        .and_then(|choice| choice.message)
        .and_then(|message| message.content)
        .unwrap_or_else(|| "(No response content)".to_string());

    Ok(ChatResponse { content })
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Returns the modification time of a file as milliseconds since Unix epoch.
/// Returns None if the file doesn't exist or the mtime can't be read.
#[tauri::command]
fn get_file_mtime(path: String) -> Result<Option<u64>, String> {
    match std::fs::metadata(&path) {
        Ok(meta) => match meta.modified() {
            Ok(time) => {
                let millis = time
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_millis() as u64;
                Ok(Some(millis))
            }
            Err(_) => Ok(None),
        },
        Err(_) => Ok(None),
    }
}

#[tauri::command]
fn write_file_content(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("Path does not exist: {}", target.display()));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", target.display()))
            .spawn()
            .map_err(|e| format!("Failed to reveal in Explorer: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let directory = target
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| target.clone());

        Command::new("xdg-open")
            .arg(directory)
            .spawn()
            .map_err(|e| format!("Failed to open containing folder: {e}"))?;
    }

    Ok(())
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Unable to determine app data directory: {e}"))
}

fn session_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn is_valid_json(data: &str) -> bool {
    matches!(
        serde_json::from_str::<serde_json::Value>(data),
        Ok(serde_json::Value::Object(_))
    )
}

fn write_synced_file(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    file.write_all(data).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn replace_file(source: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();

    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|e| e.to_string())
}

/// Atomic save: write to a temp file first, then rename to the real path.
/// Also keeps a .bak copy of the previous session so corruption of the main
/// file (e.g. crash mid-write) can be recovered from.
#[tauri::command]
fn save_session(app: tauri::AppHandle, data: String) -> Result<(), String> {
    if !is_valid_json(&data) {
        return Err("Refusing to save an invalid session document".to_string());
    }

    let dir = session_dir(&app)?;
    let path = dir.join("session.json");
    let tmp = dir.join("session.json.tmp");
    let bak = dir.join("session.json.bak");

    // Flush the complete new session before replacing the live file.
    write_synced_file(&tmp, data.as_bytes())
        .map_err(|e| format!("Failed to write temporary session file: {e}"))?;

    // Only replace a known-good backup with a valid previous session.
    if path.exists() {
        if let Ok(previous) = std::fs::read_to_string(&path) {
            if is_valid_json(&previous) {
                let _ = std::fs::copy(&path, &bak);
            }
        }
    }

    replace_file(&tmp, &path).map_err(|e| format!("Failed to replace session file: {e}"))?;

    Ok(())
}

#[tauri::command]
fn load_session(app: tauri::AppHandle) -> Result<String, String> {
    let dir = session_dir(&app)?;
    let path = dir.join("session.json");
    let tmp = dir.join("session.json.tmp");
    let bak = dir.join("session.json.bak");

    // Try the main file first
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if is_valid_json(&data) {
                return Ok(data);
            }
        }
    }

    // Main file missing / empty / corrupt — try backup
    if bak.exists() {
        if let Ok(data) = std::fs::read_to_string(&bak) {
            if is_valid_json(&data) {
                // Restore through the same safe replacement path. Recovery still
                // succeeds for this launch if the best-effort repair cannot run.
                if write_synced_file(&tmp, data.as_bytes()).is_ok() {
                    let _ = replace_file(&tmp, &path);
                }
                return Ok(data);
            }
        }
    }

    Ok(String::new())
}

#[tauri::command]
fn open_app_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = session_dir(&app)?;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ── Untitled document recovery ──

#[derive(Debug, Serialize, Deserialize)]
struct UntitledDoc {
    id: String,
    name: String,
    content: String,
}

fn untitled_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = session_dir(app)?.join("untitled");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Persist untitled (no-path) tab contents to disk for crash recovery.
/// Called periodically by the frontend auto-save logic.
#[tauri::command]
fn save_untitled_docs(app: tauri::AppHandle, docs: Vec<UntitledDoc>) -> Result<(), String> {
    let dir = untitled_dir(&app)?;
    for doc in docs {
        let path = dir.join(format!("{}.json", doc.id));
        let json = serde_json::to_string(&doc).map_err(|e| e.to_string())?;
        std::fs::write(&path, json.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Load all persisted untitled documents (for crash recovery).
#[tauri::command]
fn load_untitled_docs(app: tauri::AppHandle) -> Result<Vec<UntitledDoc>, String> {
    let dir = untitled_dir(&app)?;
    let mut docs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(data) = std::fs::read_to_string(&path) {
                    if let Ok(doc) = serde_json::from_str::<UntitledDoc>(&data) {
                        docs.push(doc);
                    }
                }
            }
        }
    }
    Ok(docs)
}

/// Remove a persisted untitled document (tab was saved or closed).
#[tauri::command]
fn remove_untitled_doc(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = untitled_dir(&app)?.join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Well-known localhost port for single-instance coordination.
/// The first instance binds this port; subsequent instances connect and forward file paths.
const INSTANCE_PORT: u16 = 48721;

#[derive(Debug, Serialize, Deserialize)]
struct InstanceMessage {
    paths: Vec<String>,
}

struct PendingOpenFiles(std::sync::Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open_files(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

fn queue_open_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if let Some(state) = app.try_state::<PendingOpenFiles>() {
        if let Ok(mut pending) = state.0.lock() {
            pending.extend(paths);
        }
    }
}

fn run_first_instance(startup_files: Vec<String>, listener: Option<TcpListener>) {
    let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();

    if let Some(listener) = listener {
        // Background thread: accept activation and file-open requests from later instances.
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if let Ok(mut stream) = stream {
                    let mut buf = String::new();
                    if stream.read_to_string(&mut buf).is_ok() {
                        if let Ok(message) = serde_json::from_str::<InstanceMessage>(&buf) {
                            // Empty paths still mean "activate the existing window".
                            let _ = tx.send(message.paths);
                        }
                    }
                }
            }
        });
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PendingOpenFiles(std::sync::Mutex::new(startup_files)))
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();

            // Watch for incoming file paths forwarded from other instances.
            // Restore the window (unminimize, show, focus) before emitting so the
            // user sees the app come to the front when double-clicking a file.
            std::thread::spawn(move || {
                for paths in rx {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    if !paths.is_empty() {
                        queue_open_files(&handle, paths);
                        let _ = handle.emit("open-file-requested", ());
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            chat_with_ai,
            read_file_content,
            write_file_content,
            get_file_mtime,
            reveal_in_folder,
            save_session,
            load_session,
            save_untitled_docs,
            load_untitled_docs,
            remove_untitled_doc,
            take_pending_open_files,
            open_app_data_dir,
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn forward_to_existing_instance(startup_files: &[String]) -> bool {
    if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", INSTANCE_PORT)) {
        let message = InstanceMessage {
            paths: startup_files.to_vec(),
        };
        if let Ok(data) = serde_json::to_vec(&message) {
            return stream.write_all(&data).and_then(|_| stream.flush()).is_ok();
        }
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(startup_files: Vec<String>) {
    // Single-instance coordination via TCP port binding.
    // First instance binds the port and starts normally.
    // Subsequent instances forward their file paths to the first instance and exit.
    match TcpListener::bind(("127.0.0.1", INSTANCE_PORT)) {
        Ok(listener) => {
            run_first_instance(startup_files, Some(listener));
        }
        Err(_) => {
            // If this is MarkFlow, ask it to activate and optionally open files.
            // If another process owns the port, continue in standalone mode.
            if !forward_to_existing_instance(&startup_files) {
                run_first_instance(startup_files, None);
            }
        }
    }
}
