import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, TerminalSquare, X } from "lucide-react";
import { Terminal } from "./Terminal";
import { disposeTerminal } from "../../stores/terminal-instances";
import { useSshStatus } from "../../hooks/use-ssh-status";
import { useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";

interface ExplorerTerminalProps {
  hostId: string;
  path: string;
  label?: string;
  onClose?: () => void;
}

export function ExplorerTerminal({ hostId, path, label = "SSH terminal", onClose }: ExplorerTerminalProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const status = useSessionStore((s) => sessionId ? s.sessions.get(sessionId)?.status : null);
  useSshStatus();

  useEffect(() => {
    let cancelled = false;
    let connectedId: string | null = null;
    setSessionId(null);
    setError(null);
    const release = (id: string) => {
      void invoke("ssh_disconnect", { sessionId: id }).catch(() => {});
      useSessionStore.getState().removeSession(id);
      disposeTerminal(id);
    };
    void invoke<string>("ssh_open_explorer_terminal", { hostId, path }).then((id) => {
      if (cancelled) { release(id); return; }
      connectedId = id;
      // This console has its own connection and no entry in the main tab bar.
      useSessionStore.setState((state) => {
        const sessions = new Map(state.sessions);
        sessions.set(id, { id, label, status: "Connected", hostConfig: { host: "", username: "", port: 22, auth_method: { type: "password", password: "" } } });
        return { sessions };
      });
      setSessionId(id);
    }).catch((err: unknown) => {
      if (!cancelled) setError(typeof err === "string" ? err : String((err as { message?: string })?.message ?? err));
    });
    return () => { cancelled = true; if (connectedId) release(connectedId); };
  }, [hostId, path, label, attempt]);

  const disconnected = status === "Disconnected" || status === "Error";
  return <div className="flex flex-col h-full min-h-0 bg-bg-base rounded-lg border border-border/60 overflow-hidden">
    <div className="flex items-center h-8 px-2.5 gap-2 shrink-0 bg-bg-surface border-b border-border/60">
      <TerminalSquare size={14} className="text-status-connected" />
      <span className="flex-1 truncate text-text-primary text-[11px] font-mono" title={`${label}: ${path}`}>{label} · {path}</span>
      {onClose && <button onClick={onClose} aria-label="Close SSH terminal" className="text-text-muted hover:text-text-primary"><X size={15} /></button>}
    </div>
    <div className="relative flex-1 min-h-0">
      {sessionId && <Terminal sessionId={sessionId} />}
      {!sessionId && !error && <div className="flex h-full items-center justify-center gap-2 text-text-muted"><Loader2 size={18} className="animate-spin" />Connecting…</div>}
      {(error || disconnected) && <div className="absolute inset-0 flex flex-col gap-3 items-center justify-center bg-bg-base/95 px-5 text-text-secondary">
        <p>{error ?? "SSH connection closed"}</p>
        <button onClick={() => setAttempt((v) => v + 1)} className="flex items-center gap-2 rounded px-3 py-1.5 bg-bg-subtle"><RefreshCw size={14} />Reconnect</button>
      </div>}
    </div>
  </div>;
}

export function ExplorerTerminalWindow({ hostId, path }: { hostId: string; path: string }) {
  const theme = useSettingsStore((s) => s.themeMode);
  const accentHue = useSettingsStore((s) => s.accentHue);
  useEffect(() => { void useSettingsStore.getState().loadSettings(); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--accent-hue", String(accentHue));
  }, [theme, accentHue]);
  return <div className="h-screen p-2 bg-bg-base"><ExplorerTerminal hostId={hostId} path={path} /></div>;
}
