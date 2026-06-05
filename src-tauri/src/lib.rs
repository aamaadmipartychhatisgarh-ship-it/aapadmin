// AAP Admin — Tauri desktop shell.
//
// Architecture (Path A — sidecar): this app is a full Next.js server (API routes,
// NextAuth, MySQL). We can't serve it as static files, so at startup we launch the
// bundled Next.js standalone server (`node-server` sidecar) which listens on
// 127.0.0.1:3000, wait until it responds, then the webview window loads it.

use std::net::TcpStream;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const SERVER_PORT: u16 = 3000;

// Block until the Next.js server is accepting TCP connections on the port,
// or until `timeout` elapses. Returns true if it came up.
fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Auto-update: checks the configured endpoint (GitHub Releases) for a newer
        // signed version and installs it on user confirmation (handled in the UI).
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Lets the updater relaunch the app after installing.
        .plugin(tauri_plugin_process::init())
        // Log to a file in the app's log dir in BOTH debug and release so that
        // "stuck on loading" failures are diagnosable. Find the log at:
        //   %LOCALAPPDATA%\in.aap.chhattisgarh.admin\logs\AAP Admin.log   (Windows)
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .build(),
        )
        .setup(|app| {
            // In dev, `beforeDevCommand` (npm run dev) already started the server,
            // so we only spawn the sidecar in a release build.
            #[cfg(not(debug_assertions))]
            {
                // The bundled server.js lives under the app's resource dir at
                // `server/server.js`. Resolve it and hand it to the node sidecar.
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("failed to resolve resource dir");
                let server_dir = resource_dir.join("server");
                let server_js = server_dir.join("server.js");

                // Tauri's resource_dir() returns a Windows extended-length path
                // (verbatim `\\?\C:\...`). Node's realpathSync can't parse that
                // prefix and fails with `EISDIR: ... lstat 'C:'`. Strip it so the
                // sidecar receives a plain `C:\...` path.
                fn strip_verbatim(p: &std::path::Path) -> String {
                    let s = p.to_string_lossy().to_string();
                    s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
                }
                let server_js_arg = strip_verbatim(&server_js);
                let server_dir_arg = strip_verbatim(&server_dir);

                log::info!("server_js_arg = {}", server_js_arg);
                log::info!("server.js exists = {}", server_js.exists());

                match app
                    .shell()
                    .sidecar("node-server")
                {
                    Ok(cmd) => {
                        let sidecar = cmd
                            .arg(&server_js_arg)
                            .current_dir(&server_dir_arg)
                            .env("PORT", SERVER_PORT.to_string())
                            .env("HOSTNAME", "127.0.0.1");

                        match sidecar.spawn() {
                            Ok((mut rx, _child)) => {
                                log::info!("node-server sidecar spawned");
                                // Drain sidecar stdout/stderr into the log file.
                                tauri::async_runtime::spawn(async move {
                                    while let Some(event) = rx.recv().await {
                                        match event {
                                            CommandEvent::Stdout(line) => {
                                                log::info!("[next] {}", String::from_utf8_lossy(&line));
                                            }
                                            CommandEvent::Stderr(line) => {
                                                log::warn!("[next] {}", String::from_utf8_lossy(&line));
                                            }
                                            CommandEvent::Error(e) => {
                                                log::error!("[next] error: {}", e);
                                            }
                                            CommandEvent::Terminated(payload) => {
                                                log::error!("[next] server exited: {:?}", payload);
                                            }
                                            _ => {}
                                        }
                                    }
                                });
                            }
                            Err(e) => {
                                log::error!("failed to spawn node-server: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("failed to create node-server sidecar command: {}", e);
                    }
                }

                // Wait for the server, then navigate the main window to it. Navigate
                // regardless after the timeout so the user at least sees the error page
                // instead of a forever-spinner.
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let up = wait_for_server(SERVER_PORT, Duration::from_secs(45));
                    log::info!("server reachable after wait = {}", up);
                    if let Some(window) = handle.get_webview_window("main") {
                        let url = format!("http://127.0.0.1:{}/", SERVER_PORT)
                            .parse()
                            .unwrap();
                        let _ = window.navigate(url);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
