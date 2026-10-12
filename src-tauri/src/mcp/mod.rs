mod clients;
mod tools;

use crate::db::HostDb;
use crate::vault::{self, StoredCredential, VaultError};
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Semaphore};
use tokio::task::{JoinHandle, JoinSet};
use tokio_util::sync::CancellationToken;

const SETTING: &str = "mcp_config";
const TOKEN_ID: &str = "anyscp-mcp-api-token";
const MAX_BODY: usize = 1024 * 1024;
const PROTOCOLS: [&str; 3] = ["2025-11-25", "2025-06-18", "2025-03-26"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct McpConfig {
    pub enabled: bool,
    pub port: u16,
    pub allow_writes: bool,
    pub allowed_host_ids: Vec<String>,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 4769,
            allow_writes: false,
            allowed_host_ids: Vec::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    config: McpConfig,
    running: bool,
    url: String,
    error: Option<String>,
}

struct Runtime {
    config: McpConfig,
    token: String,
    task: Option<JoinHandle<()>>,
    cancel: CancellationToken,
    error: Option<String>,
}

pub struct McpState {
    db: Arc<HostDb>,
    runtime: Mutex<Runtime>,
    lifetime: CancellationToken,
}

impl McpState {
    pub fn new(db: Arc<HostDb>) -> Result<Arc<Self>, String> {
        let (config, error) = match db.get_setting(SETTING).map_err(|e| e.to_string())? {
            Some(value) => match serde_json::from_str(&value) {
                Ok(config) => (config, None),
                Err(error) => (
                    McpConfig::default(),
                    Some(format!("Invalid MCP settings: {error}")),
                ),
            },
            None => (McpConfig::default(), None),
        };
        Ok(Arc::new(Self {
            db,
            runtime: Mutex::new(Runtime {
                config,
                token: String::new(),
                task: None,
                cancel: CancellationToken::new(),
                error,
            }),
            lifetime: CancellationToken::new(),
        }))
    }

    pub async fn start_saved(self: Arc<Self>) {
        let config = self.runtime.lock().await.config.clone();
        if config.enabled {
            if let Err(error) = self.configure(config, false).await {
                self.runtime.lock().await.error = Some(error);
            }
        }
    }

    async fn status(&self) -> McpStatus {
        let runtime = self.runtime.lock().await;
        McpStatus {
            config: runtime.config.clone(),
            running: runtime
                .task
                .as_ref()
                .is_some_and(|task| !task.is_finished()),
            url: format!("http://127.0.0.1:{}/mcp", runtime.config.port),
            error: runtime.error.clone(),
        }
    }

    async fn configure(
        self: &Arc<Self>,
        config: McpConfig,
        persist: bool,
    ) -> Result<McpStatus, String> {
        if config.port < 1024 {
            return Err("Choose a port between 1024 and 65535".into());
        }
        if config.allowed_host_ids.len() > 10000 {
            return Err("Too many allowed servers".into());
        }
        let token = if config.enabled {
            load_token().await?
        } else {
            String::new()
        };
        let mut runtime = self.runtime.lock().await;
        runtime.cancel.cancel();
        if let Some(task) = runtime.task.take() {
            task.await
                .map_err(|e| format!("Could not stop MCP server: {e}"))?;
        }
        let listener = if config.enabled {
            match TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, config.port)).await {
                Ok(listener) => Some(listener),
                Err(error) => {
                    runtime.error = Some(format!("Cannot listen on port {}: {error}", config.port));
                    return Err(runtime.error.clone().unwrap_or_default());
                }
            }
        } else {
            None
        };
        if persist {
            let db = self.db.clone();
            let encoded = serde_json::to_string(&config).map_err(|e| e.to_string())?;
            tokio::task::spawn_blocking(move || db.save_setting(SETTING, &encoded))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
        }
        runtime.config = config;
        runtime.token = token;
        runtime.error = None;
        runtime.cancel = CancellationToken::new();
        if let Some(listener) = listener {
            let state = self.clone();
            let cancel = runtime.cancel.clone();
            runtime.task = Some(tokio::spawn(serve(listener, state, cancel)));
        }
        drop(runtime);
        Ok(self.status().await)
    }

    pub fn stop(&self) {
        self.lifetime.cancel();
        if let Ok(mut runtime) = self.runtime.try_lock() {
            runtime.cancel.cancel();
            if let Some(task) = runtime.task.take() {
                task.abort();
            }
        }
    }
}

async fn load_token() -> Result<String, String> {
    tokio::task::spawn_blocking(|| match vault::get_credential(TOKEN_ID) {
        Ok(StoredCredential::Password { password })
            if password.len() == 64 && password.bytes().all(|byte| byte.is_ascii_hexdigit()) =>
        {
            Ok(password)
        }
        Err(VaultError::NotFound(_)) => new_token(),
        Ok(_) => Err("Invalid MCP key in the system keychain".into()),
        Err(e) => Err(format!("Unlock your system keychain to enable MCP: {e}")),
    })
    .await
    .map_err(|e| e.to_string())?
}

fn new_token() -> Result<String, String> {
    let mut random = [0u8; 32];
    getrandom::getrandom(&mut random).map_err(|e| e.to_string())?;
    let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    vault::save_credential(
        TOKEN_ID,
        &StoredCredential::Password {
            password: token.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(token)
}

async fn serve(listener: TcpListener, state: Arc<McpState>, cancel: CancellationToken) {
    let permits = Arc::new(Semaphore::new(16));
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = state.lifetime.cancelled() => break,
            Some(_) = connections.join_next(), if !connections.is_empty() => {},
            accepted = listener.accept() => {
                let (stream, _) = match accepted { Ok(value) => value, Err(_) => break };
                let Ok(permit) = permits.clone().try_acquire_owned() else { continue; };
                let state = state.clone();
                let cancel = cancel.clone();
                connections.spawn(async move {
                    let _permit = permit;
                    let service = service_fn(move |request| {
                        let state = state.clone();
                        async move { Ok::<_, Infallible>(handle_request(request, state).await) }
                    });
                    let connection = hyper::server::conn::http1::Builder::new()
                        .keep_alive(false).max_buf_size(64 * 1024)
                        .serve_connection(TokioIo::new(stream), service);
                    tokio::select! {
                        _ = cancel.cancelled() => {},
                        _ = tokio::time::timeout(Duration::from_secs(130), connection) => {},
                    }
                });
            }
        }
    }
    connections.abort_all();
    while connections.join_next().await.is_some() {}
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |result, (a, b)| result | (a ^ b))
        == 0
}

fn validate_headers(headers: &hyper::HeaderMap, port: u16, token: &str) -> Result<(), StatusCode> {
    let local = format!("127.0.0.1:{port}");
    let localhost = format!("localhost:{port}");
    let host = headers.get("host").and_then(|v| v.to_str().ok());
    if host != Some(&local) && host != Some(&localhost) {
        return Err(StatusCode::FORBIDDEN);
    }
    if let Some(origin) = headers.get("origin") {
        let origin = origin.to_str().map_err(|_| StatusCode::FORBIDDEN)?;
        if origin != format!("http://{local}") && origin != format!("http://{localhost}") {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let expected = format!("Bearer {token}");
    let provided = headers
        .get("authorization")
        .map(|v| v.as_bytes())
        .unwrap_or_default();
    if token.is_empty() || !constant_time_equal(provided, expected.as_bytes()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if let Some(version) = headers.get("mcp-protocol-version") {
        if !PROTOCOLS.contains(&version.to_str().unwrap_or_default()) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    Ok(())
}

fn response(status: StatusCode, body: Option<Value>) -> Response<Full<Bytes>> {
    let bytes = body.map(|value| value.to_string()).unwrap_or_default();
    let mut result = Response::new(Full::new(Bytes::from(bytes)));
    *result.status_mut() = status;
    result
        .headers_mut()
        .insert("content-type", "application/json".parse().unwrap());
    result
        .headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    if status == StatusCode::UNAUTHORIZED {
        result
            .headers_mut()
            .insert("www-authenticate", "Bearer".parse().unwrap());
    }
    if status == StatusCode::METHOD_NOT_ALLOWED {
        result
            .headers_mut()
            .insert("allow", "POST".parse().unwrap());
    }
    result
}

fn rpc_error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc":"2.0", "id":id, "error":{"code":code,"message":message}})
}

async fn handle_request(request: Request<Incoming>, state: Arc<McpState>) -> Response<Full<Bytes>> {
    let runtime = state.runtime.lock().await;
    if !runtime.config.enabled {
        return response(StatusCode::SERVICE_UNAVAILABLE, None);
    }
    if let Err(status) = validate_headers(request.headers(), runtime.config.port, &runtime.token) {
        return response(status, None);
    }
    let config = runtime.config.clone();
    drop(runtime);
    if request.uri().path() != "/mcp" {
        return response(StatusCode::NOT_FOUND, None);
    }
    if request.method() != Method::POST {
        return response(StatusCode::METHOD_NOT_ALLOWED, None);
    }
    if !request
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(';')
                .next()
                .is_some_and(|media| media.trim().eq_ignore_ascii_case("application/json"))
        })
    {
        return response(StatusCode::UNSUPPORTED_MEDIA_TYPE, None);
    }
    let accept = request
        .headers()
        .get("accept")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !accept.contains("application/json") || !accept.contains("text/event-stream") {
        return response(StatusCode::NOT_ACCEPTABLE, None);
    }
    let collected = match tokio::time::timeout(
        Duration::from_secs(10),
        Limited::new(request.into_body(), MAX_BODY).collect(),
    )
    .await
    {
        Ok(Ok(body)) => body.to_bytes(),
        Ok(Err(_)) => return response(StatusCode::PAYLOAD_TOO_LARGE, None),
        Err(_) => return response(StatusCode::REQUEST_TIMEOUT, None),
    };
    let message: Value = match serde_json::from_slice(&collected) {
        Ok(value) => value,
        Err(_) => {
            return response(
                StatusCode::BAD_REQUEST,
                Some(rpc_error(Value::Null, -32700, "Invalid JSON")),
            )
        }
    };
    dispatch_message(message, state, config).await
}

async fn dispatch_message(
    message: Value,
    state: Arc<McpState>,
    config: McpConfig,
) -> Response<Full<Bytes>> {
    if message["jsonrpc"] != "2.0"
        || !message["method"].is_string()
        || message
            .get("id")
            .is_some_and(|id| !id.is_string() && !id.is_number() && !id.is_null())
    {
        return response(
            StatusCode::BAD_REQUEST,
            Some(rpc_error(Value::Null, -32600, "Invalid JSON-RPC request")),
        );
    }
    let method = message["method"].as_str().unwrap_or_default();
    let Some(id) = message.get("id") else {
        return if method.starts_with("notifications/") {
            response(StatusCode::ACCEPTED, None)
        } else {
            response(
                StatusCode::BAD_REQUEST,
                Some(rpc_error(Value::Null, -32600, "A request ID is required")),
            )
        };
    };
    let result = match method {
        "initialize" => {
            let offered = message["params"]["protocolVersion"]
                .as_str()
                .unwrap_or_default();
            json!({"protocolVersion": if PROTOCOLS.contains(&offered) {offered} else {PROTOCOLS[0]},
                "capabilities":{"tools":{}}, "serverInfo":{"name":"anySCP","version":env!("CARGO_PKG_VERSION")},
                "instructions":"Use list_connections to discover allowed SSH servers and their IDs. Credentials remain inside anySCP. Paths refer to the remote server. Commands and file changes require write access in anySCP settings. The application must remain running."})
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools":tools::definitions(config.allow_writes)}),
        "resources/list" => json!({"resources":[]}),
        "prompts/list" => json!({"prompts":[]}),
        "tools/call" => {
            let Some(name) = message["params"]["name"].as_str() else {
                return response(
                    StatusCode::OK,
                    Some(rpc_error(id.clone(), -32602, "Tool name is required")),
                );
            };
            let arguments = message["params"]
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match tools::call(state.db.clone(), &config, name, arguments).await {
                Ok(data) => {
                    json!({"content":[{"type":"text","text":data.to_string()}],"structuredContent":data,"isError":false})
                }
                Err(error) => json!({"content":[{"type":"text","text":error}],"isError":true}),
            }
        }
        _ => {
            return response(
                StatusCode::OK,
                Some(rpc_error(id.clone(), -32601, "Method not found")),
            )
        }
    };
    response(
        StatusCode::OK,
        Some(json!({"jsonrpc":"2.0","id":id,"result":result})),
    )
}

#[tauri::command]
pub async fn mcp_status(state: State<'_, Arc<McpState>>) -> Result<McpStatus, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn mcp_configure(
    config: McpConfig,
    state: State<'_, Arc<McpState>>,
) -> Result<McpStatus, String> {
    state.inner().configure(config, true).await
}

#[tauri::command]
pub async fn mcp_rotate_token(state: State<'_, Arc<McpState>>) -> Result<McpStatus, String> {
    tokio::task::spawn_blocking(new_token)
        .await
        .map_err(|e| e.to_string())??;
    let config = state.runtime.lock().await.config.clone();
    state.inner().configure(config, false).await
}

#[tauri::command]
pub async fn mcp_client_config(
    state: State<'_, Arc<McpState>>,
) -> Result<clients::ClientConfigs, String> {
    let runtime = state.runtime.lock().await;
    if runtime.task.as_ref().is_none_or(|task| task.is_finished()) {
        return Err("Enable the MCP server first".into());
    }
    clients::configs(runtime.config.port, &runtime.token)
}

#[tauri::command]
pub async fn mcp_install_client(
    client: String,
    state: State<'_, Arc<McpState>>,
) -> Result<String, String> {
    let runtime = state.runtime.lock().await;
    if runtime.task.as_ref().is_none_or(|task| task.is_finished()) {
        return Err("Enable the MCP server first".into());
    }
    let port = runtime.config.port;
    let token = runtime.token.clone();
    drop(runtime);
    tokio::task::spawn_blocking(move || clients::install(&client, port, &token))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_transport_rejects_missing_tokens_and_foreign_origins() {
        let mut headers = hyper::HeaderMap::new();
        headers.insert("host", "127.0.0.1:4769".parse().unwrap());
        assert_eq!(
            validate_headers(&headers, 4769, "secret"),
            Err(StatusCode::UNAUTHORIZED)
        );
        headers.insert("authorization", "Bearer secret".parse().unwrap());
        assert!(validate_headers(&headers, 4769, "secret").is_ok());
        headers.insert("origin", "https://example.com".parse().unwrap());
        assert_eq!(
            validate_headers(&headers, 4769, "secret"),
            Err(StatusCode::FORBIDDEN)
        );
        headers.remove("origin");
        headers.insert("host", "attacker.example:4769".parse().unwrap());
        assert_eq!(
            validate_headers(&headers, 4769, "secret"),
            Err(StatusCode::FORBIDDEN)
        );
    }

    #[test]
    fn tokens_and_protocol_versions_are_validated() {
        let mut headers = hyper::HeaderMap::new();
        headers.insert("host", "localhost:4769".parse().unwrap());
        headers.insert("authorization", "Bearer secreu".parse().unwrap());
        assert_eq!(
            validate_headers(&headers, 4769, "secret"),
            Err(StatusCode::UNAUTHORIZED)
        );
        headers.insert("authorization", "Bearer secret".parse().unwrap());
        headers.insert("mcp-protocol-version", "1900-01-01".parse().unwrap());
        assert_eq!(
            validate_headers(&headers, 4769, "secret"),
            Err(StatusCode::BAD_REQUEST)
        );
    }

    #[tokio::test]
    async fn initialization_and_tools_match_the_client_protocol() {
        let directory = tempfile::tempdir().unwrap();
        let state = McpState::new(Arc::new(HostDb::new(directory.path()).unwrap())).unwrap();
        let config = McpConfig {
            enabled: true,
            ..Default::default()
        };
        let response = dispatch_message(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}), state.clone(), config.clone()).await;
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["id"], 1);
        assert_eq!(value["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(value["result"]["serverInfo"]["name"], "anySCP");
        let response = dispatch_message(
            json!({"jsonrpc":"2.0","id":"tools","method":"tools/list"}),
            state,
            config,
        )
        .await;
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&body).unwrap();
        let tools = value["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 4);
        assert!(tools
            .iter()
            .all(|tool| tool["annotations"]["readOnlyHint"] == true));
    }

    #[tokio::test]
    async fn protocol_errors_and_notifications_have_correct_response_shapes() {
        let directory = tempfile::tempdir().unwrap();
        let state = McpState::new(Arc::new(HostDb::new(directory.path()).unwrap())).unwrap();
        let config = McpConfig {
            enabled: true,
            ..Default::default()
        };
        let response = dispatch_message(
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            state.clone(),
            config.clone(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert!(response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .is_empty());
        let response = dispatch_message(
            json!({"jsonrpc":"2.0","id":7,"method":"unknown"}),
            state,
            config,
        )
        .await;
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["id"], 7);
        assert_eq!(value["error"]["code"], -32601);
    }
}
