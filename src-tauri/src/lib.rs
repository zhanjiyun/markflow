use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
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
        .header("Authorization", format!("Bearer {}", request.api_key.trim()))
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

fn session_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json"))
}

#[tauri::command]
fn save_session(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = session_file_path(&app)?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_session(app: tauri::AppHandle) -> Result<String, String> {
    let path = session_file_path(&app)?;
    if path.exists() {
        std::fs::read_to_string(path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
        .invoke_handler(tauri::generate_handler![
            chat_with_ai,
            read_file_content,
            write_file_content,
            reveal_in_folder,
            save_session,
            load_session,
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
