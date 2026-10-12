use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use toml_edit::{DocumentMut, Item, Table};

#[derive(Serialize)]
pub struct ClientConfigs {
    codex: String,
    claude: String,
}

fn connection(port: u16, token: &str) -> Value {
    json!({"type":"http","url":format!("http://127.0.0.1:{port}/mcp"),"headers":{"Authorization":format!("Bearer {token}")}})
}

fn codex_config(original: &str, port: u16, token: &str) -> Result<String, String> {
    let mut document: DocumentMut = original
        .parse()
        .map_err(|e| format!("Invalid Codex configuration: {e}"))?;
    if !document.contains_key("mcp_servers") {
        document["mcp_servers"] = Item::Table(Table::new());
    }
    let servers = document["mcp_servers"]
        .as_table_mut()
        .ok_or("mcp_servers must be a TOML table")?;
    let mut server = Table::new();
    server["url"] = toml_edit::value(format!("http://127.0.0.1:{port}/mcp"));
    server["startup_timeout_sec"] = toml_edit::value(15);
    server["tool_timeout_sec"] = toml_edit::value(150);
    let mut headers = Table::new();
    headers["Authorization"] = toml_edit::value(format!("Bearer {token}"));
    server["http_headers"] = Item::Table(headers);
    servers["anyscp"] = Item::Table(server);
    Ok(document.to_string())
}

fn claude_config(original: &str, port: u16, token: &str) -> Result<String, String> {
    let mut document: Value = if original.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(original)
            .map_err(|e| format!("Invalid Claude Code configuration: {e}"))?
    };
    let object = document
        .as_object_mut()
        .ok_or("Claude Code configuration must be a JSON object")?;
    let servers = object
        .entry("mcpServers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("mcpServers must be a JSON object")?;
    servers.insert("anyscp".into(), connection(port, token));
    serde_json::to_string_pretty(&document)
        .map(|value| value + "\n")
        .map_err(|e| e.to_string())
}

pub fn configs(port: u16, token: &str) -> Result<ClientConfigs, String> {
    Ok(ClientConfigs {
        codex: codex_config("", port, token)?,
        claude: serde_json::to_string_pretty(
            &json!({"mcpServers":{"anyscp":connection(port, token)}}),
        )
        .map_err(|e| e.to_string())?,
    })
}

fn write_private(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    file.write_all(contents).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

pub fn install(client: &str, port: u16, token: &str) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Cannot resolve home directory")?;
    let path = match client {
        "codex" => std::env::var_os("CODEX_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"))
            .join("config.toml"),
        "claude" => home.join(".claude.json"),
        _ => return Err("Unknown MCP client".into()),
    };
    if path.is_symlink() {
        return Err(
            "Client configuration is a symbolic link; use the manual configuration instead".into(),
        );
    }
    let existed = path.exists();
    let original = if existed {
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
            return Err("Client configuration exceeds 16 MiB".into());
        }
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let rendered = match client {
        "codex" => codex_config(&original, port, token)?,
        _ => claude_config(&original, port, token)?,
    };
    let parent = path
        .parent()
        .ok_or("Configuration has no parent directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .ok_or("Invalid configuration path")?
        .to_string_lossy();
    let id = uuid::Uuid::new_v4();
    let backup = parent.join(format!("{file_name}.anyscp-backup-{id}"));
    if existed {
        write_private(&backup, original.as_bytes())?;
    }
    let staging = parent.join(format!(".{file_name}.anyscp-{id}.tmp"));
    write_private(&staging, rendered.as_bytes())?;
    // Avoid replacing edits made by another application since we read the file.
    if path.exists() != existed
        || (existed && fs::read_to_string(&path).map_err(|e| e.to_string())? != original)
    {
        return Err("Client configuration changed while connecting; retry after closing its settings editor".into());
    }
    fs::rename(&staging, &path).map_err(|e| format!("Cannot install client configuration: {e}"))?;
    Ok(if existed {
        format!(
            "Connected. Backup: {}. Start a new client session.",
            backup.display()
        )
    } else {
        "Connected. Start a new client session.".into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_registration_preserves_other_settings_and_servers() {
        let original = "# Keep this comment\nmodel = 'custom'\n[mcp_servers.other]\nurl = 'https://example.com/mcp'\n";
        let rendered = codex_config(original, 4769, "secret").unwrap();
        let document: DocumentMut = rendered.parse().unwrap();
        assert_eq!(document["model"].as_str(), Some("custom"));
        assert_eq!(
            document["mcp_servers"]["other"]["url"].as_str(),
            Some("https://example.com/mcp")
        );
        assert_eq!(
            document["mcp_servers"]["anyscp"]["http_headers"]["Authorization"].as_str(),
            Some("Bearer secret")
        );
        assert!(rendered.contains("# Keep this comment"));
    }

    #[test]
    fn claude_registration_preserves_user_configuration() {
        let rendered = claude_config(
            r#"{"theme":"dark","mcpServers":{"other":{"type":"stdio","command":"other"}}}"#,
            4769,
            "secret",
        )
        .unwrap();
        let value: Value = serde_json::from_str(&rendered).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["command"], "other");
        assert_eq!(
            value["mcpServers"]["anyscp"]["headers"]["Authorization"],
            "Bearer secret"
        );
        assert!(claude_config("invalid json", 4769, "secret").is_err());
    }
}
