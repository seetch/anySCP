import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExplorerTerminal } from "../terminal/ExplorerTerminal";
import { toast } from "../../stores/toast-store";
import { FolderOpen, Cloud, TerminalSquare, Loader2 } from "lucide-react";
import { ExplorerView } from "./ExplorerView";
import { S3Browser } from "../s3/S3Browser";
import { useSftpStore } from "../../stores/sftp-store";
import { useS3Store } from "../../stores/s3-store";
import type { Transport } from "../../lib/explorer-transport";

interface ExplorerPageProps {
  /** SFTP/SCP transport session id (both live in the sftp store). */
  sftpSessionId?: string;
  /** Defaults to "sftp"; "scp" when the host fell back to SCP. */
  transport?: Transport;
  s3SessionId?: string;
  /** Whether this tab is the active/visible one. Explorer tabs stay mounted
   *  (issue #17), so document-level listeners must only fire for the active one. */
  isActive?: boolean;
}

export function ExplorerPage({ sftpSessionId, transport = "sftp", s3SessionId, isActive = true }: ExplorerPageProps) {
  const sftpSession = useSftpStore((s) => sftpSessionId ? s.sessions.get(sftpSessionId) : null);
  const s3Session = useS3Store((s) => s3SessionId ? s.sessions.get(s3SessionId) : null);

  const [consolePath, setConsolePath] = useState<string | null>(null);
  const [openingConsole, setOpeningConsole] = useState(false);
  const [consoleWidth, setConsoleWidth] = useState(42);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const openConsole = async () => {
    if (!sftpSession?.hostId || openingConsole) return;
    if (consolePath !== null) { setConsolePath(null); return; }
    setOpeningConsole(true);
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      if (await appWindow.isMaximized() || await appWindow.isFullscreen()) {
        setConsolePath(sftpSession.currentPath);
      } else {
        await invoke("open_explorer_terminal_window", { hostId: sftpSession.hostId, path: sftpSession.currentPath });
      }
    } catch (error) {
      toast.error(`Unable to open SSH terminal: ${String(error)}`);
    } finally {
      setOpeningConsole(false);
    }
  };
  const resizeConsole = (event: React.PointerEvent) => {
    event.preventDefault();
    dragCleanup.current?.();
    const move = (e: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setConsoleWidth(Math.max(25, Math.min(65, (rect.right - e.clientX) / rect.width * 100)));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      dragCleanup.current = null;
    };
    dragCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };

  const baseLabel = sftpSession?.label ?? s3Session?.label ?? "Explorer";
  // Surface SCP fallback subtly so the user understands why server-side
  // metadata (timestamps, etc.) may look slightly different.
  const label = sftpSessionId && transport === "scp" ? `${baseLabel} · SCP` : baseLabel;
  const isSftp = !!sftpSessionId;
  const Icon = isSftp ? FolderOpen : Cloud;

  return (
    <div ref={containerRef} className="flex h-full p-2 min-w-0">
      <div className="flex flex-col flex-1 min-w-0 min-h-0 rounded-lg overflow-hidden border border-border/60">
        {/* Pane header — matching terminal pane style */}
        <div className="flex items-center h-8 px-2.5 gap-2.5 shrink-0 no-select bg-bg-surface/80 border-b border-border/60">
          <Icon size={14} strokeWidth={1.8} className="shrink-0 text-status-connected" aria-hidden="true" />
          <span className="text-[11px] font-mono truncate flex-1 min-w-0 text-text-primary leading-none" title={label}>
            {label}
          </span>
          {sftpSession && <button data-testid="explorer-terminal" onClick={() => void openConsole()} disabled={!sftpSession.hostId || openingConsole} title={sftpSession.hostId ? "Open SSH terminal in current directory" : "Save this host to open its terminal"} aria-label="Open SSH terminal" className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-subtle disabled:opacity-40">
            {openingConsole ? <Loader2 size={15} className="animate-spin" /> : <TerminalSquare size={15} />}
          </button>}
        </div>

        {/* Browser content */}
        <div
          className="flex-1 min-h-0 bg-bg-base"
          data-explorer-transport={sftpSessionId ? transport : s3SessionId ? "s3" : undefined}
        >
          {sftpSessionId && <ExplorerView sessionId={sftpSessionId} transport={transport} isActive={isActive} />}
          {s3SessionId && <S3Browser sessionId={s3SessionId} isActive={isActive} />}
        </div>
      </div>
      {consolePath !== null && sftpSession?.hostId && <>
        <div role="separator" aria-label="Resize SSH terminal" aria-orientation="vertical" aria-valuenow={Math.round(consoleWidth)} aria-valuemin={25} aria-valuemax={65} tabIndex={0} onPointerDown={resizeConsole} onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setConsoleWidth((v) => Math.max(25, Math.min(65, v + (e.key === "ArrowLeft" ? 2 : -2))));
          }
        }} className="w-2 shrink-0 cursor-col-resize hover:bg-accent/20 focus-visible:bg-accent/20 rounded" />
        <div className="shrink-0 min-w-0 h-full" style={{ width: `${consoleWidth}%` }}>
          <ExplorerTerminal hostId={sftpSession.hostId} path={consolePath} label={baseLabel} onClose={() => setConsolePath(null)} />
        </div>
      </>}
    </div>
  );
}
