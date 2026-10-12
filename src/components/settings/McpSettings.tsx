import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, RefreshCw, ShieldCheck, Plug } from "lucide-react";
import { useHostsStore } from "../../stores/hosts-store";
import { toast } from "../../stores/toast-store";

interface McpConfig {
  enabled: boolean;
  port: number;
  allowWrites: boolean;
  allowedHostIds: string[];
}

interface McpStatus {
  config: McpConfig;
  running: boolean;
  url: string;
  error: string | null;
}

interface ClientConfigs {
  codex: string;
  claude: string;
}

const CARD = "rounded-xl bg-bg-surface border border-border/50 px-4 py-4";
const BUTTON = "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[length:var(--text-sm)] font-medium border border-border bg-bg-base text-text-secondary hover:text-text-primary hover:border-border-focus disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const INPUT = "px-3 py-2 rounded-lg bg-bg-base border border-border text-text-primary text-[length:var(--text-sm)] focus:outline-none focus:ring-2 focus:ring-ring";

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "MCP operation failed";
}

export function McpSettings() {
  const hosts = useHostsStore((state) => state.hosts);
  const loadHosts = useHostsStore((state) => state.loadHosts);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<ClientConfigs | null>(null);

  useEffect(() => {
    let mounted = true;
    void loadHosts();
    void invoke<McpStatus>("mcp_status").then((value) => {
      if (mounted) { setStatus(value); setConfig(value.config); setError(value.error); }
    }).catch((error: unknown) => { if (mounted) setError(errorMessage(error)); });
    return () => { mounted = false; };
  }, [loadHosts]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (error: unknown) {
      setError(errorMessage(error));
      const current = await invoke<McpStatus>("mcp_status").catch(() => null);
      if (current) setStatus(current);
    }
    finally { setBusy(false); }
  }

  async function save() {
    if (!config) return;
    await perform(async () => {
      const result = await invoke<McpStatus>("mcp_configure", { config });
      setStatus(result);
      setConfig(result.config);
      setManual(null);
      toast.success(result.running ? "MCP server is running" : "MCP server is disabled");
    });
  }

  async function refresh() {
    await perform(async () => {
      const result = await invoke<McpStatus>("mcp_status");
      setStatus(result);
      setError(result.error);
    });
  }

  async function connect(client: "codex" | "claude") {
    await perform(async () => {
      const message = await invoke<string>("mcp_install_client", { client });
      toast.success(message);
    });
  }

  async function copy(client: "codex" | "claude") {
    await perform(async () => {
      const value = await invoke<ClientConfigs>("mcp_client_config");
      await writeText(value[client]);
      toast.success("Connection configuration copied");
    });
  }

  if (!config) return <p className="text-text-muted text-[length:var(--text-sm)]">{error ?? "Loading MCP settings…"}</p>;

  const dirty = JSON.stringify(config) !== JSON.stringify(status?.config);
  const connectionReady = Boolean(status?.running) && !dirty && !busy;

  return (
    <div className="space-y-6" data-testid="mcp-settings">
      {error && <div role="alert" className="rounded-xl border border-status-error/40 bg-bg-surface p-4 text-[length:var(--text-sm)] text-status-error">{error}</div>}

      <section className={CARD}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-medium text-text-primary flex items-center gap-2"><Plug size={16} /> MCP server</h2>
            <p className="text-[length:var(--text-xs)] text-text-muted mt-1">Available to local AI clients while anySCP is running.</p>
          </div>
          <span role="status" className={`text-[length:var(--text-xs)] ${status?.running ? "text-accent" : "text-text-muted"}`}>
            {status?.running ? "Running" : "Stopped"}
          </span>
        </div>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-3 text-[length:var(--text-sm)] text-text-primary">
            <input type="checkbox" checked={config.enabled} disabled={busy} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} />
            Enable MCP server
          </label>
          <label className="flex items-center justify-between gap-4 text-[length:var(--text-sm)] text-text-secondary">
            Local port
            <input aria-label="MCP port" className={`${INPUT} w-28`} type="number" min={1024} max={65535} value={config.port} disabled={busy}
              onChange={(event) => setConfig({ ...config, port: Number(event.target.value) })} />
          </label>
          <p className="font-mono break-all text-[length:var(--text-xs)] text-text-muted">http://127.0.0.1:{config.port}/mcp</p>
          <p className="text-[length:var(--text-xs)] text-text-muted">UTF-8 file limit: 100 MiB for reading and writing. Command output: 512 KiB.</p>
          <label className="flex items-start gap-3 text-[length:var(--text-sm)] text-text-primary">
            <input type="checkbox" className="mt-1" checked={config.allowWrites} disabled={busy} onChange={(event) => setConfig({ ...config, allowWrites: event.target.checked })} />
            <span>Allow commands and file changes<span className="block mt-1 text-[length:var(--text-xs)] text-text-muted">Lets connected clients run shell commands, write, rename and delete files on the selected servers.</span></span>
          </label>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="font-medium text-text-primary flex items-center gap-2"><ShieldCheck size={16} /> Allowed servers</h2>
        <p className="text-[length:var(--text-xs)] text-text-muted mt-1 mb-3">Only these saved SSH profiles are visible to MCP clients. Passwords and private keys stay inside anySCP.</p>
        {hosts.length === 0 ? <p className="text-[length:var(--text-sm)] text-text-muted">Add a saved SSH server first.</p> : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {hosts.map((host) => (
              <label key={host.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-overlay text-[length:var(--text-sm)] text-text-secondary">
                <input type="checkbox" checked={config.allowedHostIds.includes(host.id)} disabled={busy} onChange={(event) => setConfig({
                  ...config,
                  allowedHostIds: event.target.checked ? [...config.allowedHostIds, host.id] : config.allowedHostIds.filter((id) => id !== host.id),
                })} />
                <span>{host.label || host.host}<span className="block text-[length:var(--text-xs)] text-text-muted">{host.username}@{host.host}:{host.port}</span></span>
              </label>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${BUTTON} !bg-accent !text-white`} disabled={busy || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535} onClick={() => void save()}>Apply settings</button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /> Refresh status</button>
      </div>

      <section className={CARD}>
        <h2 className="font-medium text-text-primary mb-1">Connect your AI clients</h2>
        <p className="text-[length:var(--text-xs)] text-text-muted mb-4">Adds anySCP to the client’s user configuration and keeps its other settings and MCP servers. Existing configuration is backed up first. Start a new client session after connecting.</p>
        {!status?.running && <p className="text-[length:var(--text-sm)] text-text-muted mb-4">Enable the server and apply your settings first.</p>}
        {dirty && <p className="text-[length:var(--text-sm)] text-text-muted mb-4">Apply the pending settings before connecting a client.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([{ id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex" }] as const).map((client) => (
            <div key={client.id} className="rounded-lg border border-border p-3">
              <h3 className="font-medium text-text-primary text-[length:var(--text-sm)] mb-3">{client.label}</h3>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BUTTON} disabled={!connectionReady} onClick={() => void connect(client.id)}>Connect {client.label}</button>
                <button type="button" className={BUTTON} disabled={!connectionReady} onClick={() => void copy(client.id)}><Copy size={14} /> Copy config</button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="button" className={BUTTON} disabled={!connectionReady} onClick={() => void perform(async () => { setManual(await invoke<ClientConfigs>("mcp_client_config")); })}>Show manual configuration</button>
          <button type="button" className={BUTTON} disabled={!connectionReady} onClick={() => void perform(async () => {
            const result = await invoke<McpStatus>("mcp_rotate_token");
            setStatus(result);
            setManual(null);
            toast.info("Connection key replaced. Reconnect Claude Code and Codex to update their keys.");
          })}>Replace connection key</button>
        </div>
        {manual && <div className="space-y-3 mt-4">
          <p className="text-[length:var(--text-xs)] text-text-muted">These configurations include your private MCP connection key.</p>
          {(["claude", "codex"] as const).map((client) => <div key={client}>
            <label htmlFor={`mcp-config-${client}`} className="block text-[length:var(--text-xs)] text-text-secondary mb-1">{client === "claude" ? "Claude Code" : "Codex"}</label>
            <textarea id={`mcp-config-${client}`} readOnly rows={8} value={manual[client]} className={`${INPUT} w-full font-mono text-[length:var(--text-xs)]`} />
          </div>)}
        </div>}
      </section>
    </div>
  );
}
