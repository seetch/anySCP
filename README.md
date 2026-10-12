<p align="center">
  <img src="screens/header.png" alt="AnySCP" width="100%"/>
</p>

<p align="center">
  <strong>A modern desktop client for SSH, SFTP, and S3 with a clean, powerful interface</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#screenshots">Screenshots</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#building">Building</a> &bull;
  <a href="#contributing">Contributing</a> &bull;
  <a href="https://discord.gg/3xNRbNAmYb">Discord</a> &bull;
  <a href="https://join.slack.com/t/anyscp/shared_invite/zt-40b1jsfg4-f9rq_xRof_MVQqLXSPDE2Q">Slack</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="https://github.com/macnev2013/anySCP/releases"><img src="https://img.shields.io/github/v/release/macnev2013/anySCP" alt="Release"/></a>
  <a href="https://github.com/macnev2013/anySCP/releases"><img src="https://img.shields.io/github/downloads/macnev2013/anySCP/total" alt="Downloads"/></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform"/>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License MIT"/></a>
  <a href="https://github.com/macnev2013/anySCP/stargazers"><img src="https://img.shields.io/github/stars/macnev2013/anySCP?style=social" alt="Stars"/></a>
  <img src="https://visitor-badge.laobi.icu/badge?page_id=macnev2013.anySCP&label=Views&color=blue" alt="Views"/>
  <a href="https://discord.gg/3xNRbNAmYb"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white" alt="Discord"/></a>
  <a href="https://join.slack.com/t/anyscp/shared_invite/zt-40b1jsfg4-f9rq_xRof_MVQqLXSPDE2Q"><img src="https://img.shields.io/badge/Slack-Join%20us-4A154B?logo=slack&logoColor=white" alt="Slack"/></a>
</p>

<p align="center">
  Free and open-source alternative to Termius, PuTTY, and WinSCP.<br/>
  A cross-platform SSH client, SFTP file manager, and S3 desktop browser with split panes, drag-and-drop uploads, and command snippets.
</p>

---

<p align="center">
  <img src="screens/anyscp.gif" alt="AnySCP Demo" width="800"/>
</p>
<p align="center"><em>SSH terminals, SFTP file management, and S3 cloud storage -- all in one app.</em></p>

---

## 🚀 Overview

AnySCP is a free, open-source desktop application that combines an SSH terminal, SFTP file explorer, and S3-compatible cloud storage browser into a single, fast, privacy-first tool. Built with Tauri v2 (Rust backend + React frontend), it runs natively on macOS, Windows, and Linux. No cloud accounts, no subscriptions -- your credentials stay on your machine.

## ⚡ How AnySCP Compares

| Feature             | AnySCP              | Termius      | PuTTY   | WinSCP  | Cyberduck |
| ------------------- | ------------------- | ------------ | ------- | ------- | --------- |
| SSH Terminal        | Yes                 | Yes          | Yes     | No      | No        |
| SFTP Browser        | Yes                 | Yes          | No      | Yes     | Yes       |
| S3 Browser          | Yes                 | No           | No      | No      | Yes       |
| Split Panes         | Yes                 | Yes          | No      | No      | No        |
| Port Forwarding     | Yes                 | Yes          | Yes     | No      | No        |
| Command Snippets    | Yes                 | Yes          | No      | No      | No        |
| Cross-Platform      | Yes                 | Yes          | Windows | Windows | Yes       |
| Free (no limits)    | Yes                 | No           | Yes     | Yes     | Yes       |
| No Account Required | Yes                 | No           | Yes     | Yes     | Yes       |
| Open Source         | Yes                 | No           | Yes     | Yes     | Yes (GPL) |
| Credential Privacy  | Local (OS keychain) | Cloud-synced | Local   | Local   | Local     |

## ✨ Features

### 💻 SSH Terminal Client

- Full-featured terminal emulator powered by xterm.js with GPU-accelerated WebGL rendering
- Split terminal panes (horizontal and vertical) within a single SSH session
- In-terminal search with regex support
- Tabbed SSH sessions with keyboard shortcuts
- Configurable keep-alive intervals, startup commands, default shell, and proxy jump (bastion host)
- SSH key authentication with automatic PPK-to-OpenSSH conversion
- Import connections from `~/.ssh/config`

### 📁 SFTP File Manager

- Browse, upload, download, rename, move, copy, and delete remote files and directories
- Drag-and-drop file upload from your desktop directly into the remote file browser
- Multi-select files with Ctrl+Click and Shift+Click for bulk operations
- Cut, copy, and paste files between remote directories
- Inline file and folder creation
- Edit remote files in VS Code -- automatically re-uploads when you save
- Transfer queue with real-time progress bars, transfer speed, and ETA
- Concurrent file transfers with configurable parallelism

### ☁️ S3 Cloud Storage Browser

- Connect to **Amazon S3**, **MinIO**, **Cloudflare R2**, **Backblaze B2**, **Wasabi**, **DigitalOcean Spaces**, or any S3-compatible storage service
- Same file browser UI as SFTP -- sort, multi-select, context menus, keyboard shortcuts
- Drag-and-drop upload with recursive directory support
- Create files, create folders, bulk delete (including recursive folder delete)
- Generate and copy presigned URLs for sharing
- Edit S3 objects in VS Code with automatic re-upload on save
- Transfer progress tracking with speed and ETA
- Switch between multiple buckets within a single connection

### 🔗 Server & Connection Management

- Save SSH hosts and S3 connections with labels, colors, environment tags, and notes
- Organize connections into color-coded groups
- Import SSH hosts from `~/.ssh/config` with one click
- One-click connect using credentials stored in your OS keychain
- Recent connections list for quick access
- Full connection history with audit log

### 📋 Command Snippets Library

- Save frequently used shell commands with labels and descriptions
- Create parameterized command templates with `{{variable}}` placeholders
- Organize snippets into folders
- Quick-insert panel accessible from any terminal session
- Full-text search across all saved snippets

### 🔀 SSH Port Forwarding

- Set up local and remote SSH tunnels
- Create, start, and stop port forwarding rules per host
- Tunnels create their own SSH connections automatically -- no terminal session needed
- Monitor active tunnel status in real time
- Presets for common services (PostgreSQL, MySQL, Redis, MongoDB, HTTP, Kubernetes)

### 🔐 Security & Privacy

- Credentials stored in your **OS keychain** (macOS Keychain, Windows Credential Manager, Linux libsecret/KWallet)
- SSH private keys and passwords never leave the Rust backend process
- Fully offline -- no internet connection required after installation
- Open source -- audit the code yourself

### MCP for Claude Code and Codex

Open **Settings → MCP & AI clients**, select the SSH profiles you want to expose, enable the server, and click **Apply settings**. The local Streamable HTTP endpoint defaults to `http://127.0.0.1:4769/mcp` and is available while anySCP is running.

- Read-only tools: `list_connections`, `list_files`, `read_file`, and `stat_file`.
- Enable **Allow commands and file changes** to also expose `run_command`, `write_file`, `create_directory`, `rename_file`, and `delete_file`.
- Passwords and private keys remain in the Rust backend. The server requires a separate MCP bearer key stored in the system keychain and only listens on localhost.
- **Connect Claude Code** and **Connect Codex** add the `anyscp` MCP entry to each client's user configuration. Other settings and MCP servers are preserved; existing configuration is backed up before replacement. Start a new client session afterwards.
- **Copy config** and **Show manual configuration** provide configurations for manual setup. Reconnect clients after changing the port or replacing the connection key.

Remote UTF-8 text files are limited to 100 MiB (measured in bytes); command output remains limited to 512 KiB. File operations have a 90-second timeout. The HTTP request limit accounts for JSON escaping, with at most two requests processed concurrently. Commands default to a 30-second timeout (maximum 90 seconds). File tools use SFTP; saved ProxyJump connections are supported. Existing files are preserved by `write_file` unless `overwrite` is explicitly true. `delete_file` removes individual files, not recursive directories.

The file browser sends SSH keepalive probes every 30 seconds by default (including SFTP-only and ProxyJump connections). Positive host-specific keepalive values override this interval. A lost SFTP channel is reopened when listing a directory; if necessary, saved profiles reconnect using the vault credentials. Writes are never automatically replayed.

SFTP/SCP navigation includes Back, Forward, Parent and a recent-directory menu, with Alt+Left/Right/Up shortcuts. The last 20 visited directories are saved per host and suggested in the path field. The SSH terminal button opens an independent console in the current directory: a resizable right pane in a maximized/fullscreen window, otherwise a separate application window. Repeated clicks show/hide that same console, preserving its SSH connection, running commands, scrollback and working directory. Closing the console hides it; closing its explorer tab releases the connection.

Drop local files or folders on a remote directory to upload there, with an overwrite prompt. Drag remote selections out of the window, or use Ctrl/Cmd+drag, to download. If staging takes longer than the gesture, use the Ready download button to begin a fresh drag after the files finish downloading. Linux drag-out uses GTK directly, with escaped file URIs and data retained until the receiving application finishes. Desktop integration under Wayland still needs a manual check. The regular Download action remains available.


## 📸 Screenshots

|                Connection Manager                |                SSH Terminal                |
| :----------------------------------------------: | :----------------------------------------: |
|     ![Connection Manager](screens/hosts.png)     |   ![SSH Terminal](screens/terminal.png)    |
| _Organize servers with groups, colors, and tags_ | _Split panes, search, and tabbed sessions_ |

|               File Explorer               |              Command Snippets               |
| :---------------------------------------: | :-----------------------------------------: |
|  ![File Explorer](screens/explorer.png)   |      ![Snippets](screens/snippets.png)      |
| _SFTP & S3 with drag-drop, context menus_ | _Parameterized templates with quick-insert_ |

## 📥 Installation

### Download

1. Download the latest release from the [Releases](https://github.com/macnev2013/anySCP/releases) page
2. Choose the right file for your platform:
   - **macOS (Apple Silicon)**: `.dmg` (aarch64)
   - **macOS (Intel)**: `.dmg` (x64)
   - **Windows**: `.msi` or `.exe`
   - **Linux**: `.deb` or `.AppImage`
3. Install and launch

> **macOS note**: If you see "app is damaged", run: `xattr -cr /Applications/anyscp.app`

### Updating

Already have anySCP installed? Go to **Settings → About & Updates** and click **Check** to update in-app — or turn on **Automatic Updates** to install new releases automatically.

### Requirements

- macOS 11+, Windows 10+, or Linux (Ubuntu 22.04+)
- On Linux: a running Secret Service provider (such as KWallet or GNOME Keyring) with an unlocked default wallet/keyring to save and retrieve credentials across login sessions
- For SFTP: SSH access to remote servers
- For S3: Access key and secret key (or S3-compatible credentials)

## 🔨 Building

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [pnpm](https://pnpm.io)
- [Rust](https://rustup.rs) (latest stable)
- Platform-specific Tauri dependencies: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Build Instructions

```bash
# Clone the repository
git clone https://github.com/macnev2013/anyscp.git
cd anyscp

# Install frontend dependencies
pnpm install

# Run in development mode (hot-reload)
pnpm tauri dev

# Build for production (generates platform-specific installer)
pnpm tauri build
```

## 🛠 Tech Stack

| Layer              | Technology                                         |
| ------------------ | -------------------------------------------------- |
| Desktop runtime    | [Tauri v2](https://v2.tauri.app)                   |
| Backend            | Rust (tokio, russh, russh-sftp, rust-s3, rusqlite) |
| Frontend           | React 19, TypeScript (strict), Tailwind CSS v4     |
| Terminal           | xterm.js with WebGL renderer                       |
| State management   | Zustand                                            |
| Credential storage | OS keychain via `keyring` crate                    |
| Database           | SQLite (bundled, zero config)                      |

## 🏗 Architecture

AnySCP follows a strict frontend/backend separation:

- **Rust does the heavy lifting** -- all SSH, SFTP, S3, encryption, and file I/O runs in Rust
- **React is a thin view layer** -- renders UI and manages local state via Zustand
- **Tauri IPC** bridges the two with type-safe commands (request/response) and events (server push)
- **Credentials never cross the IPC boundary** -- the frontend never sees passwords or private keys
- **Shared `FileSystemProvider` abstraction** -- SFTP and S3 browsers use identical UI components with capability flags that show/hide features per protocol

### Project Structure

```
src/                          # React frontend
  components/
    terminal/                 # SSH terminal, split panes, search
    explorer/                 # Shared file table, toolbar, drop zone
    sftp/                     # SFTP browser, session tabs
    s3/                       # S3 browser, connect dialog
    dashboard/                # Host cards, groups, connection manager
    snippets/                 # Command snippet library
    transfers/                # Transfer progress popover
  stores/                     # Zustand state stores
  providers/                  # SFTP & S3 file system providers
  types/                      # TypeScript type definitions

src-tauri/src/                # Rust backend
  ssh/                        # SSH connections, PTY, key management
  sftp/                       # SFTP sessions, transfer manager
  s3/                         # S3 sessions, transfer manager
  db/                         # SQLite persistence layer
  vault/                      # OS keychain integration
  snippets/                   # Snippet storage
  portforward/                # SSH tunnel management
  import/                     # SSH config parser
```

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit your changes**: `git commit -m 'Add amazing feature'`
4. **Push to the branch**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

Please open an issue first to discuss what you'd like to change.

## 🐛 Troubleshooting

### Linux Credential Storage

Linux credentials are stored persistently in the desktop Secret Service, rather than the session-only kernel keyring. Unlock your default wallet/keyring when prompted. After upgrading from a build using the kernel keyring, re-enter and save each password or SSH key passphrase once; credentials already lost at logout cannot be recovered. Saved server profiles remain intact.

### SSH Connection Issues

- **Can't connect**: Verify host, port, username, and credentials
- **Authentication failed**: Check password or SSH key permissions
- **Timeout**: Check firewall settings and network connectivity

### S3 Connection Issues

- **Access Denied**: Verify your access key and secret key are correct
- **Bucket not found**: Check the bucket name and region settings
- **Invalid credentials**: Ensure IAM user has S3 permissions

### File Operations

- **Permission denied**: Ensure your user has appropriate file permissions
- **Upload failed**: Check available disk space on remote server

### macOS

- **"App is damaged"**: Run `xattr -cr /Applications/anyscp.app`

## 📄 License

This project is licensed under the MIT License -- see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Tauri](https://tauri.app) by the Tauri team
- SSH implementation powered by [russh](https://github.com/warp-tech/russh)
- Terminal emulation powered by [xterm.js](https://xtermjs.org)
- S3 support powered by [rust-s3](https://github.com/durch/rust-s3)

## 💬 Support

- **Discord**: [Join our community](https://discord.gg/3xNRbNAmYb)
- **Slack**: [Join our workspace](https://join.slack.com/t/anyscp/shared_invite/zt-40b1jsfg4-f9rq_xRof_MVQqLXSPDE2Q)
- **Issues**: [GitHub Issues](https://github.com/macnev2013/anySCP/issues)
- **Discussions**: [GitHub Discussions](https://github.com/macnev2013/anySCP/discussions)

---

<p align="center">
  If you find AnySCP useful, please consider giving it a <a href="https://github.com/macnev2013/anySCP">star on GitHub</a>!
</p>

<p align="center">
  <a href="#top">Back to top</a>
</p>
