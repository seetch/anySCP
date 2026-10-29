import { useEffect } from "react";

export function shortcutKey(event: Pick<KeyboardEvent, "code" | "key">): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  const punctuation: Record<string, string> = {
    BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=",
    Semicolon: ";", Quote: "'", Backquote: "`", Comma: ",", Period: ".", Slash: "/",
  };
  return punctuation[event.code] ?? event.key.toLowerCase();
}

export interface ShortcutDef {
  /** Lowercase key, e.g. "k", "d", "b", "1"–"9", "[", "]" */
  key: string;
  /** Requires Cmd (mac) / Ctrl (win/linux) */
  meta: boolean;
  shift?: boolean;
  action: () => void;
  /** Only fire when this returns true */
  when?: () => boolean;
}

/**
 * Central keyboard shortcut handler.
 * Call once at AppShell level with the full shortcut table.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDef[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.altKey) return;
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const isTerminal = !!target.closest(".xterm");
      const isMac = navigator.platform.includes("Mac");
      if (isTerminal && (e.ctrlKey || !isMac || !e.metaKey)) return;
      if (!isTerminal && target.closest("input, textarea, select, [contenteditable='true']")) return;
      const meta = isMac ? e.metaKey : e.ctrlKey;
      const key = shortcutKey(e);

      for (const s of shortcuts) {
        if (s.meta !== meta) continue;
        if ((s.shift ?? false) !== e.shiftKey) continue;
        if (key !== s.key) continue;
        if (s.when && !s.when()) continue;

        e.preventDefault();
        e.stopPropagation();
        s.action();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [shortcuts]);
}
