import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  FolderUp,
  FolderPlus,
  FilePlus,
  RefreshCw,
  ChevronRight,
  Home,
  Loader2,
  Shield,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  History,
} from "lucide-react";
import type { FileSystemProvider } from "../../types/explorer";

interface BreadcrumbSegment {
  label: string;
  path: string;
}

interface ExplorerToolbarProps {
  provider: FileSystemProvider;
  currentPath: string;
  segments: BreadcrumbSegment[];
  loading: boolean;
  onRefresh: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onNavigate: (path: string) => void;
  onUpload: () => void;
  /** Optional folder-upload action. When provided, a companion "Upload folder"
   *  button is shown next to the file-upload button (mirrors New file/New
   *  folder). Transports without recursive upload can leave it undefined. */
  onUploadFolder?: () => void;
  busy?: boolean;
  sudoMode?: boolean;
  sudoBusy?: boolean;
  onToggleSudo?: () => void;
  onBack?: () => void;
  onForward?: () => void;
  recentPaths?: string[];
}

// cache icons so they render once
const ICON_BTN_CLASS = [
  "flex items-center justify-center w-7 h-7 rounded-md shrink-0",
  "text-text-muted hover:text-text-secondary hover:bg-bg-subtle",
  "transition-colors duration-[var(--duration-fast)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:opacity-40 disabled:cursor-not-allowed",
].join(" ");
const PATH_INPUT_CLASS = [
  "flex-1 min-w-0 mx-1 px-1.5 py-0.5 rounded",
  "bg-bg-subtle text-text-primary text-[length:var(--text-sm)]",
  "border border-ring outline-none",
].join(" ");
const BREADCRUMB_BAR_CLASS =
  "flex items-center gap-0 overflow-x-auto flex-1 min-w-0 mx-1 cursor-text rounded hover:bg-bg-subtle/40";
const SEGMENT_BTN_BASE_CLASS = [
  "px-1 py-0.5 rounded text-[length:var(--text-sm)]",
  "transition-colors duration-[var(--duration-fast)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
].join(" ");
const SEGMENT_BTN_LAST_CLASS = "text-text-primary font-medium cursor-default";
const SEGMENT_BTN_LINK_CLASS =
  "text-text-muted hover:text-text-secondary hover:bg-bg-subtle/70 cursor-pointer";

/**
 * Normalize a hand-typed path to the provider's convention: SFTP paths are
 * absolute with no trailing slash; S3 prefixes have no leading slash and a
 * trailing one ("a/b/"), matching how the breadcrumb segments are built —
 * listing uses the "/" delimiter, so a prefix without it would show the
 * folder itself instead of its contents.
 */
function normalizePath(
  providerType: FileSystemProvider["type"],
  raw: string,
): string {
  const trimmed = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (providerType === "sftp") {
    const stripped = trimmed.replace(/\/+$/, "");
    if (stripped === "") return "/";
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }
  const prefix = trimmed.replace(/^\/+/, "");
  return prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix;
}

export const ExplorerToolbar = memo(function ExplorerToolbar({
  provider,
  currentPath,
  segments,
  loading,
  onRefresh,
  onNewFolder,
  onNewFile,
  onNavigate,
  onUpload,
  onUploadFolder,
  busy,
  sudoMode,
  sudoBusy,
  onToggleSudo,
  onBack,
  onForward,
  recentPaths = [],
}: ExplorerToolbarProps) {
  const caps = provider.capabilities;
  const providerType = provider.type;

  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftPath, setDraftPath] = useState(currentPath);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const suggestions = isEditing && !showHistory
    ? recentPaths.filter((path) => path.toLowerCase().includes(draftPath === currentPath ? "" : draftPath.toLowerCase()))
    : recentPaths;
  const choosePath = (path: string) => {
    setShowHistory(false);
    setIsEditing(false);
    setDraftPath(path);
    setSuggestionIndex(-1);
    onNavigate(normalizePath(providerType, path));
  };
  useEffect(() => {
    if (!isEditing && !showHistory) return;
    const position = () => setMenuRect((isEditing ? inputRef.current : historyRef.current)?.getBoundingClientRect() ?? null);
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [isEditing, showHistory]);

  useEffect(() => {
    if (!showHistory) return;
    const close = (event: PointerEvent) => {
      if (!historyRef.current?.contains(event.target as Node) && !suggestionsRef.current?.contains(event.target as Node)) setShowHistory(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setShowHistory(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [showHistory]);

  // Focus + select only when editing begins — re-running on a currentPath
  // change mid-edit would stomp the user's cursor/selection
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  // Keep the draft in sync with the real path while not editing
  useEffect(() => {
    if (!isEditing) setDraftPath(currentPath);
  }, [isEditing, currentPath]);
  const beginEdit = useCallback(() => {
    if (loading) return;
    setDraftPath(currentPath);
    setIsEditing(true);
  }, [loading, currentPath]);
  const commitEdit = useCallback(() => {
    setIsEditing(false);
    const trimmed = draftPath.trim();
    if (trimmed.length > 0 && trimmed !== currentPath) {
      const normalized = normalizePath(providerType, trimmed);
      if (normalized !== currentPath) onNavigate(normalized);
    }
  }, [draftPath, currentPath, providerType, onNavigate]);
  const cancelEdit = useCallback(() => {
    setDraftPath(currentPath);
    setIsEditing(false);
  }, [currentPath]);
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestionIndex((index) => Math.max(0, Math.min(suggestions.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (suggestionIndex >= 0 && suggestions[suggestionIndex]) choosePath(suggestions[suggestionIndex]);
        else inputRef.current?.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    },
    [cancelEdit, suggestions, suggestionIndex, choosePath],
  );
  const handleHome = useCallback(
    () => onNavigate(providerType === "sftp" ? "/" : ""),
    [onNavigate, providerType],
  );
  const isAtRoot =
    providerType === "sftp" ? currentPath === "/" : currentPath === "";

  return (
    <div className="flex items-center h-10 px-2 border-b border-border bg-bg-surface shrink-0 gap-1 no-select">
      {providerType === "sftp" && <>
        <button data-testid="explorer-back" onClick={onBack} disabled={loading || !onBack} title="Back (Alt+Left)" aria-label="Go back" className={ICON_BTN_CLASS}><ArrowLeft size={15} /></button>
        <button data-testid="explorer-forward" onClick={onForward} disabled={loading || !onForward} title="Forward (Alt+Right)" aria-label="Go forward" className={ICON_BTN_CLASS}><ArrowRight size={15} /></button>
        <button data-testid="explorer-up" onClick={() => onNavigate(provider.parentPath(currentPath))} disabled={loading || isAtRoot} title="Parent directory (Alt+Up)" aria-label="Go to parent directory" className={ICON_BTN_CLASS}><ArrowUp size={15} /></button>
        <div className="relative shrink-0" ref={historyRef}>
          <button data-testid="explorer-history" onPointerDown={(event) => event.preventDefault()} onClick={() => setShowHistory((v) => !v)} disabled={loading || recentPaths.length === 0} title="Recent directories" aria-label="Recent directories" aria-expanded={showHistory} className={ICON_BTN_CLASS}><History size={15} /></button>

        </div>
      </>}
      {/* Home button */}
      <button
        data-testid="explorer-home"
        onClick={handleHome}
        disabled={loading || isAtRoot}
        title={`Go to ${provider.rootLabel()}`}
        aria-label="Go to root"
        className={ICON_BTN_CLASS}
      >
        <Home size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {(showHistory || isEditing) && suggestions.length > 0 && menuRect && createPortal(
        <div ref={suggestionsRef} role="listbox" aria-label="Recent directories" className="fixed z-[100] overflow-auto rounded-lg border border-border bg-bg-overlay p-1 shadow-[var(--shadow-lg)]" style={{ top: menuRect.bottom + 4, left: Math.max(8, Math.min(menuRect.left, window.innerWidth - 328)), width: Math.min(Math.max(menuRect.width, 320), window.innerWidth - 16), maxHeight: Math.max(80, Math.min(256, window.innerHeight - menuRect.bottom - 12)) }} onPointerDown={(event) => event.preventDefault()}>
          <p className="px-2 py-1 text-text-muted text-[length:var(--text-xs)]">Recent directories</p>
          {suggestions.map((path, index) => <button key={path} type="button" role="option" aria-selected={index === suggestionIndex} title={path} className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-[length:var(--text-sm)] text-text-primary hover:bg-bg-subtle ${index === suggestionIndex ? "bg-bg-subtle" : ""}`} onClick={() => choosePath(path)}><History size={14} className="shrink-0 text-text-muted" /><span className="truncate font-mono">{path}</span></button>)}
        </div>, document.body)}
      {/* Breadcrumb path */}
      {isEditing ? (
        <input
          ref={inputRef}
          data-testid="explorer-path-input"
          type="text"
          value={draftPath}
          onChange={(e) => { setDraftPath(e.target.value); setSuggestionIndex(-1); }}
          onBlur={commitEdit}
          onKeyDown={handleInputKeyDown}
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="Edit current path"
          className={PATH_INPUT_CLASS}
        />
      ) : (
        <div
          onClick={beginEdit}
          // Keyboard path to edit mode: the bar itself is focusable and Enter
          // begins editing (segment buttons keep their own click behavior).
          // No role="button" — it contains real buttons, and nesting
          // interactive roles is an ARIA violation.
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target === e.currentTarget) {
              e.preventDefault();
              beginEdit();
            }
          }}
          title="Click to type a path"
          aria-label="Current path"
          className={`${BREADCRUMB_BAR_CLASS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          {segments.map((seg, index) => {
            const isLast = index === segments.length - 1;
            const isRoot = index === 0;

            return (
              <span
                key={`${seg.path}-${index}`}
                className="flex items-center shrink-0"
              >
                {!isRoot && (
                  <ChevronRight
                    size={12}
                    strokeWidth={2}
                    className="text-text-muted/50 mx-0.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <button
                  onClick={(e) => {
                    // Segment clicks navigate directly; don't let the click bubble up and open edit mode on the same action.
                    e.stopPropagation();
                    if (!isLast) onNavigate(seg.path);
                  }}
                  disabled={isLast}
                  title={isLast ? seg.path : `Navigate to ${seg.path}`}
                  className={`${SEGMENT_BTN_BASE_CLASS} ${isLast ? SEGMENT_BTN_LAST_CLASS : SEGMENT_BTN_LINK_CLASS}`}
                >
                  {isRoot ? provider.rootLabel() : seg.label}
                </button>
              </span>
            );
          })}
          {/* Fills remaining empty space so clicking past the last segment still opens edit mode */}
          <span className="flex-1 min-w-2 h-full" />
        </div>
      )}

      {/* Busy spinner */}
      {busy && (
        <Loader2
          size={15}
          strokeWidth={2}
          className="text-accent motion-safe:animate-spin shrink-0"
          aria-label="Operation in progress"
        />
      )}

      {/* Separator */}
      <span className="w-px h-4 bg-border shrink-0" aria-hidden="true" />

      {/* Upload file */}
      {caps.canUpload && (
        <button
          data-testid="explorer-upload"
          onClick={onUpload}
          disabled={loading}
          title="Upload files"
          aria-label="Upload files"
          className={ICON_BTN_CLASS}
        >
          <Upload size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {/* Upload folder */}
      {caps.canUpload && onUploadFolder && (
        <button
          data-testid="explorer-upload-folder"
          onClick={onUploadFolder}
          disabled={loading}
          title="Upload folder"
          aria-label="Upload folder"
          className={ICON_BTN_CLASS}
        >
          <FolderUp size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {/* New file */}
      {caps.canCreateFile && (
        <button
          data-testid="explorer-new-file"
          onClick={onNewFile}
          disabled={loading}
          title="New file"
          aria-label="New file"
          className={ICON_BTN_CLASS}
        >
          <FilePlus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {/* New folder */}
      {caps.canCreateFolder && (
        <button
          data-testid="explorer-new-folder"
          onClick={onNewFolder}
          disabled={loading}
          title="New folder"
          aria-label="New folder"
          className={ICON_BTN_CLASS}
        >
          <FolderPlus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {/* Refresh */}
      <button
        data-testid="explorer-refresh"
        onClick={onRefresh}
        disabled={loading}
        title="Refresh"
        aria-label="Refresh"
        className={ICON_BTN_CLASS}
      >
        <RefreshCw
          size={15}
          strokeWidth={1.8}
          aria-hidden="true"
          className={loading ? "motion-safe:animate-spin" : ""}
        />
      </button>

      {onToggleSudo && (
        <button
          data-testid="explorer-sudo-toggle"
          onClick={onToggleSudo}
          disabled={sudoBusy}
          aria-busy={sudoBusy}
          title={sudoMode ? "Disable sudo mode" : "Enable sudo mode"}
          aria-label={sudoMode ? "Disable sudo mode" : "Enable sudo mode"}
          aria-pressed={!!sudoMode}
          className={
            sudoMode
              ? `${ICON_BTN_CLASS} text-accent bg-accent/15 hover:bg-accent/25 hover:text-accent`
              : ICON_BTN_CLASS
          }
        >
          {sudoBusy ? (
            <Loader2
              size={15}
              strokeWidth={1.8}
              aria-hidden="true"
              className="motion-safe:animate-spin"
            />
          ) : (
            <Shield size={15} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
});
