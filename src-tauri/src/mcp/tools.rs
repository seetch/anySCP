use super::McpConfig;
use crate::db::HostDb;
use crate::ssh::{commands::build_host_config_blocking, manager::SshManager};
use russh::{client, ChannelMsg};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(super) const MAX_FILE_SIZE: usize = 100 * 1024 * 1024;
const MAX_COMMAND_OUTPUT: usize = 512 * 1024;
const WRITE_TOOLS: [&str; 5] = [
    "run_command",
    "write_file",
    "create_directory",
    "rename_file",
    "delete_file",
];

pub fn definitions(writes: bool) -> Vec<Value> {
    let host =
        json!({"type":"string","description":"Saved connection ID returned by list_connections"});
    let path = json!({"type":"string","description":"Remote path. ~/ is expanded to the remote home directory."});
    let specs = [
        ("list_connections", "List allowed saved SSH servers, their IDs and connection notes. Passwords and private keys are never returned.", json!({}), json!([])),
        ("list_files", "List a remote directory through SFTP, up to 1000 entries. Defaults to the remote home directory.", json!({"host_id":host,"path":path}), json!(["host_id"])),
        ("read_file", "Read a remote UTF-8 text file, up to 100 MiB.", json!({"host_id":host,"path":path}), json!(["host_id","path"])),
        ("stat_file", "Get remote file size, type and modification time.", json!({"host_id":host,"path":path}), json!(["host_id","path"])),
        ("run_command", "Execute a shell command on an allowed SSH server and return stdout, stderr and exit code. Requires write/command access. Output is limited to 512 KiB; timeout defaults to 30 seconds.", json!({"host_id":host,"command":{"type":"string"},"timeout_seconds":{"type":"integer","minimum":1,"maximum":90}}), json!(["host_id","command"])),
        ("write_file", "Write a UTF-8 remote file (maximum 100 MiB). Existing files are preserved unless overwrite is explicitly true.", json!({"host_id":host,"path":path,"content":{"type":"string"},"overwrite":{"type":"boolean","default":false}}), json!(["host_id","path","content"])),
        ("create_directory", "Create a remote directory. Parent directories must already exist.", json!({"host_id":host,"path":path}), json!(["host_id","path"])),
        ("rename_file", "Rename a remote file or directory using SFTP.", json!({"host_id":host,"path":path,"new_path":path}), json!(["host_id","path","new_path"])),
        ("delete_file", "Delete a single remote file. Does not delete directories recursively.", json!({"host_id":host,"path":path}), json!(["host_id","path"])),
    ];
    specs.into_iter().filter(|(name, _, _, _)| writes || !WRITE_TOOLS.contains(name))
        .map(|(name, description, properties, required)| json!({
            "name":name,"description":description,
            "inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false},
            "annotations":{"readOnlyHint":!WRITE_TOOLS.contains(&name),"destructiveHint":WRITE_TOOLS.contains(&name),"openWorldHint":false}
        })).collect()
}

fn text<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    let value = arguments[key]
        .as_str()
        .ok_or_else(|| format!("{key} must be a string"))?;
    if value.is_empty() || value.contains('\0') || value.len() > 8192 {
        return Err(format!(
            "{key} must be nonempty, no longer than 8192 bytes, and contain no NUL characters"
        ));
    }
    Ok(value)
}

fn validate_file_size(bytes: usize) -> Result<(), String> {
    if bytes > MAX_FILE_SIZE {
        Err("File exceeds 100 MiB".into())
    } else {
        Ok(())
    }
}

fn authorize(config: &McpConfig, name: &str, arguments: &Value) -> Result<(), String> {
    if !config.enabled {
        return Err("MCP is disabled".into());
    }
    if WRITE_TOOLS.contains(&name) && !config.allow_writes {
        return Err("Commands and file changes are disabled in anySCP MCP settings".into());
    }
    let tools = definitions(config.allow_writes);
    let definition = tools
        .iter()
        .find(|tool| tool["name"] == name)
        .ok_or_else(|| "Unknown MCP tool".to_string())?;
    let schema = &definition["inputSchema"];
    let object = arguments
        .as_object()
        .ok_or("Tool arguments must be an object")?;
    for (key, value) in object {
        let field = &schema["properties"][key];
        let valid = match field["type"].as_str() {
            Some("string") => value.is_string(),
            Some("boolean") => value.is_boolean(),
            Some("integer") => value.as_u64().is_some_and(|v| (1..=90).contains(&v)),
            _ => false,
        };
        if !valid {
            return Err(format!("Invalid argument: {key}"));
        }
    }
    for key in schema["required"].as_array().into_iter().flatten() {
        let key = key.as_str().unwrap_or_default();
        if !object.contains_key(key) {
            return Err(format!("Missing required argument: {key}"));
        }
    }
    if name != "list_connections" {
        let id = text(arguments, "host_id")?;
        if !config.allowed_host_ids.iter().any(|allowed| allowed == id) {
            return Err("This server is not allowed in anySCP MCP settings".into());
        }
    }
    if name == "write_file" {
        validate_file_size(arguments["content"].as_str().unwrap_or_default().len())?;
    }
    Ok(())
}

pub async fn call(
    db: Arc<HostDb>,
    config: &McpConfig,
    name: &str,
    arguments: Value,
) -> Result<Value, String> {
    authorize(config, name, &arguments)?;
    if name == "list_connections" {
        let allowed = config.allowed_host_ids.clone();
        return tokio::task::spawn_blocking(move || {
            let hosts = db.list_hosts().map_err(|e| e.to_string())?;
            let connections: Vec<Value> = hosts.into_iter().filter(|host| allowed.contains(&host.id))
                .map(|host| json!({"id":host.id,"label":host.label,"host":host.host,"port":host.port,
                    "username":host.username,"group_id":host.group_id,"notes":host.notes,"environment":host.environment,
                    "os_type":host.os_type,"start_directory":host.start_directory})).collect();
            Ok(json!({"connections":connections}))
        }).await.map_err(|e| e.to_string())?;
    }
    let id = text(&arguments, "host_id")?.to_string();
    let command = if name == "run_command" {
        Some(text(&arguments, "command")?.to_string())
    } else {
        None
    };
    let host_config =
        tokio::task::spawn_blocking(move || build_host_config_blocking(&id, &db, &mut Vec::new()))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    let seconds = arguments["timeout_seconds"].as_u64().unwrap_or(30);
    let (handle, chain) = tokio::time::timeout(
        Duration::from_secs(30),
        SshManager::establish(&host_config, Arc::new(client::Config::default())),
    )
    .await
    .map_err(|_| "SSH connection timed out")?
    .map_err(|e| e.to_string())?;
    let result = if let Some(command) = command {
        tokio::time::timeout(Duration::from_secs(seconds), run_command(&handle, &command))
            .await
            .unwrap_or_else(|_| Err("Command timed out; the SSH channel was closed".to_string()))
    } else {
        tokio::time::timeout(
            Duration::from_secs(90),
            file_operation(&handle, name, &arguments),
        )
        .await
        .unwrap_or_else(|_| Err("SFTP operation timed out".to_string()))
    };
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        handle.disconnect(russh::Disconnect::ByApplication, "", "en"),
    )
    .await;
    drop(chain);
    result
}

async fn run_command(
    handle: &client::Handle<crate::ssh::handler::SshClientHandler>,
    command: &str,
) -> Result<Value, String> {
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    channel
        .exec(true, command)
        .await
        .map_err(|e| e.to_string())?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
            ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
            ChannelMsg::Close => break,
            _ => {}
        }
        if stdout.len() + stderr.len() > MAX_COMMAND_OUTPUT {
            let _ = channel.close().await;
            return Err("Command output exceeded 512 KiB; the channel was closed".into());
        }
    }
    let exit_code = exit_code.ok_or("SSH channel closed without a command exit status")?;
    Ok(
        json!({"stdout":String::from_utf8_lossy(&stdout),"stderr":String::from_utf8_lossy(&stderr),"exit_code":exit_code}),
    )
}

async fn expand_path(sftp: &SftpSession, path: &str) -> Result<String, String> {
    if path == "~" || path.starts_with("~/") {
        let home = sftp.canonicalize(".").await.map_err(|e| e.to_string())?;
        return Ok(if path == "~" {
            home
        } else {
            format!("{}/{}", home.trim_end_matches('/'), &path[2..])
        });
    }
    Ok(path.to_string())
}

async fn file_operation(
    handle: &client::Handle<crate::ssh::handler::SshClientHandler>,
    name: &str,
    arguments: &Value,
) -> Result<Value, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| e.to_string())?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| e.to_string())?;
    let result = operate(&sftp, name, arguments).await;
    let _ = sftp.close().await;
    result
}

async fn operate(sftp: &SftpSession, name: &str, arguments: &Value) -> Result<Value, String> {
    let raw = if name == "list_files" && arguments.get("path").is_none() {
        "."
    } else {
        text(arguments, "path")?
    };
    let path = expand_path(sftp, raw).await?;
    match name {
        "list_files" => {
            let mut listing = sftp.read_dir(&path).await.map_err(|e| e.to_string())?;
            let entries: Vec<Value> = listing.by_ref().take(1000).map(|entry| {
                let metadata = entry.metadata();
                json!({"name":entry.file_name(),"size":metadata.len(),"type":format!("{:?}", entry.file_type())})
            }).collect();
            Ok(json!({"path":path,"entries":entries,"truncated":listing.next().is_some()}))
        }
        "read_file" => {
            let file = sftp.open(&path).await.map_err(|e| e.to_string())?;
            let mut data = Vec::new();
            file.take((MAX_FILE_SIZE + 1) as u64)
                .read_to_end(&mut data)
                .await
                .map_err(|e| e.to_string())?;
            validate_file_size(data.len())?;
            let content = String::from_utf8(data).map_err(|_| "File is not UTF-8 text")?;
            Ok(json!({"path":path,"content":content}))
        }
        "stat_file" => {
            let metadata = sftp.metadata(&path).await.map_err(|e| e.to_string())?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            Ok(
                json!({"path":path,"size":metadata.len(),"type":format!("{:?}", metadata.file_type()),"modified":modified}),
            )
        }
        "write_file" => {
            let content = arguments["content"]
                .as_str()
                .ok_or("content must be a string")?;
            validate_file_size(content.len())?;
            let overwrite = arguments["overwrite"].as_bool().unwrap_or(false);
            let flags = OpenFlags::CREATE
                | OpenFlags::WRITE
                | if overwrite {
                    OpenFlags::TRUNCATE
                } else {
                    OpenFlags::EXCLUDE
                };
            let mut file = sftp
                .open_with_flags(&path, flags)
                .await
                .map_err(|e| e.to_string())?;
            file.write_all(content.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            file.shutdown().await.map_err(|e| e.to_string())?;
            Ok(json!({"path":path,"bytes_written":content.len()}))
        }
        "create_directory" => {
            sftp.create_dir(&path).await.map_err(|e| e.to_string())?;
            Ok(json!({"path":path,"created":true}))
        }
        "rename_file" => {
            let new_path = expand_path(sftp, text(arguments, "new_path")?).await?;
            sftp.rename(&path, &new_path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({"path":path,"new_path":new_path}))
        }
        "delete_file" => {
            sftp.remove_file(&path).await.map_err(|e| e.to_string())?;
            Ok(json!({"path":path,"deleted":true}))
        }
        _ => Err("Unknown file operation".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_limit_is_inclusive_and_independent_of_command_output() {
        assert!(validate_file_size(MAX_FILE_SIZE).is_ok());
        assert!(validate_file_size(MAX_FILE_SIZE + 1).is_err());
        assert_eq!(MAX_FILE_SIZE, 100 * 1024 * 1024);
        assert_eq!(MAX_COMMAND_OUTPUT, 512 * 1024);
    }

    #[test]
    fn read_only_mode_and_host_allowlist_are_enforced_before_io() {
        let mut config = McpConfig {
            enabled: true,
            allowed_host_ids: vec!["allowed".into()],
            ..Default::default()
        };
        assert!(authorize(
            &config,
            "read_file",
            &json!({"host_id":"other","path":"/etc/hosts"})
        )
        .is_err());
        assert!(authorize(
            &config,
            "run_command",
            &json!({"host_id":"allowed","command":"id"})
        )
        .is_err());
        assert!(authorize(
            &config,
            "read_file",
            &json!({"host_id":"allowed","path":"/etc/hosts"})
        )
        .is_ok());
        config.allow_writes = true;
        assert!(authorize(
            &config,
            "run_command",
            &json!({"host_id":"allowed","command":"id","timeout_seconds":91})
        )
        .is_err());
        assert!(authorize(
            &config,
            "run_command",
            &json!({"host_id":"allowed","command":"id"})
        )
        .is_ok());
        config.enabled = false;
        assert!(authorize(&config, "list_connections", &json!({})).is_err());
    }
}
