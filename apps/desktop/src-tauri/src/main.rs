#[tauri::command]
fn ping_runtime() -> &'static str {
    "pong"
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping_runtime])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
