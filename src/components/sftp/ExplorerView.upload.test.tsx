import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Tauri module mocks ───────────────────────────────────────────────────────
// ExplorerView imports `invoke` at module level and lazily imports the dialog
// plugin, the event channel, and the drag-drop webview API. Mock them all so
// the component mounts in jsdom without a real Tauri runtime.

const { invoke, dialogOpen, dropListener } = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]) => [] as unknown),
  dialogOpen: vi.fn(),
  dropListener: { current: null as ((event: { payload: { type: string; paths: string[]; position: { x: number; y: number } } }) => void) | null },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: dialogOpen }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: vi.fn(async (callback) => {
      dropListener.current = callback;
      return () => { dropListener.current = null; };
    }),
  }),
}));

import { ExplorerView } from "./ExplorerView";
import { useSftpStore } from "../../stores/sftp-store";
import type { SftpEntry } from "../../types";

const SESSION_ID = "sess-1";
const CURRENT_PATH = "/home/user";

class TestPointerEvent extends MouseEvent {
  readonly pointerId = 1;
}

function seedSession(): void {
  const store = useSftpStore.getState();
  store.openSession(SESSION_ID, "ssh-1", "Test host", "user");
  // Drive currentPath to a non-root dir so we can assert remoteDir precisely.
  store.setEntries(SESSION_ID, CURRENT_PATH, []);
}

/** Find the enqueue_upload invoke call, if any. */
function enqueueCall(): unknown[] | undefined {
  return invoke.mock.calls.find((c) => c[0] === "sftp_enqueue_upload");
}

describe("ExplorerView — upload button", () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockResolvedValue([]);
    dialogOpen.mockReset();
    // Fresh store between tests.
    useSftpStore.setState({ sessions: new Map(), activeSftpSessionId: null, clipboard: null });
    seedSession();
  });

  it("opens the native file picker and enqueues the selected files (issue #69)", async () => {
    dialogOpen.mockResolvedValue(["/local/a.txt", "/local/b.txt"]);

    render(<ExplorerView sessionId={SESSION_ID} />);
    fireEvent.click(await screen.findByTestId("explorer-upload"));

    await waitFor(() => expect(dialogOpen).toHaveBeenCalledTimes(1));
    expect(dialogOpen).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: true }),
    );

    await waitFor(() => expect(enqueueCall()).toBeDefined());
    expect(enqueueCall()?.[1]).toEqual({
      sftpSessionId: SESSION_ID,
      localPaths: ["/local/a.txt", "/local/b.txt"],
      remoteDir: CURRENT_PATH,
    });
  });

  it("normalizes a single-path selection into a one-element array", async () => {
    dialogOpen.mockResolvedValue("/local/only.txt");

    render(<ExplorerView sessionId={SESSION_ID} />);
    fireEvent.click(await screen.findByTestId("explorer-upload"));

    await waitFor(() => expect(enqueueCall()).toBeDefined());
    expect(enqueueCall()?.[1]).toMatchObject({
      localPaths: ["/local/only.txt"],
      remoteDir: CURRENT_PATH,
    });
  });

  it("enqueues nothing when the picker is cancelled", async () => {
    dialogOpen.mockResolvedValue(null);

    render(<ExplorerView sessionId={SESSION_ID} />);
    fireEvent.click(await screen.findByTestId("explorer-upload"));

    await waitFor(() => expect(dialogOpen).toHaveBeenCalledTimes(1));
    // Give any (incorrect) follow-up invoke a chance to fire before asserting.
    await Promise.resolve();
    expect(enqueueCall()).toBeUndefined();
  });

  it("opens the folder picker in directory mode and enqueues the selected folders", async () => {
    dialogOpen.mockResolvedValue(["/local/projects", "/local/assets"]);

    render(<ExplorerView sessionId={SESSION_ID} />);
    fireEvent.click(await screen.findByTestId("explorer-upload-folder"));

    await waitFor(() => expect(dialogOpen).toHaveBeenCalledTimes(1));
    expect(dialogOpen).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: true }),
    );

    // A picked folder is handed to the same enqueue path as files; the backend
    // recreates it remotely and walks it recursively.
    await waitFor(() => expect(enqueueCall()).toBeDefined());
    expect(enqueueCall()?.[1]).toEqual({
      sftpSessionId: SESSION_ID,
      localPaths: ["/local/projects", "/local/assets"],
      remoteDir: CURRENT_PATH,
    });
  });

  it("enqueues nothing when the folder picker is cancelled", async () => {
    dialogOpen.mockResolvedValue(null);

    render(<ExplorerView sessionId={SESSION_ID} />);
    fireEvent.click(await screen.findByTestId("explorer-upload-folder"));

    await waitFor(() => expect(dialogOpen).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(enqueueCall()).toBeUndefined();
  });
});

describe("ExplorerView navigation and recovery", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue([]);
    useSftpStore.setState({ sessions: new Map(), activeSftpSessionId: null, clipboard: null, recentDirectories: {} });
    seedSession();
  });

  async function navigate(path: string) {
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.loading).toBe(false));
    fireEvent.click(screen.getByLabelText("Current path"));
    const input = screen.getByTestId("explorer-path-input");
    fireEvent.change(input, { target: { value: path } });
    fireEvent.blur(input);
  }

  it("goes back and forward and discards the forward branch after new navigation", async () => {
    render(<ExplorerView sessionId={SESSION_ID} />);
    await navigate("/srv");
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.currentPath).toBe("/srv"));
    fireEvent.click(screen.getByTestId("explorer-back"));
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.currentPath).toBe(CURRENT_PATH));
    expect(screen.getByTestId("explorer-forward")).toBeEnabled();
    fireEvent.click(screen.getByTestId("explorer-forward"));
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.currentPath).toBe("/srv"));
    fireEvent.click(screen.getByTestId("explorer-back"));
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.currentPath).toBe(CURRENT_PATH));
    await navigate("/opt");
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.currentPath).toBe("/opt"));
    expect(screen.getByTestId("explorer-forward")).toBeDisabled();
    expect(useSftpStore.getState().sessions.get(SESSION_ID)?.history).toEqual([CURRENT_PATH, "/opt"]);
  });

  it("reconnects a lost channel and retries the requested directory on the same tab", async () => {
    render(<ExplorerView sessionId={SESSION_ID} />);
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.loading).toBe(false));
    let failed = false;
    invoke.mockImplementation(async (command, args) => {
      if (command === "sftp_reconnect") return "ssh-restored";
      if (command === "sftp_list_dir" && (args as { path: string }).path === "/srv" && !failed) {
        failed = true;
        throw { kind: "protocol_error", message: "Protocol error: SendError: channel closed" };
      }
      return [];
    });
    await navigate("/srv");
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.currentPath).toBe("/srv"));
    expect(useSftpStore.getState().sessions.get(SESSION_ID)?.sshSessionId).toBe("ssh-restored");
    expect(invoke).toHaveBeenCalledWith("sftp_reconnect", { sftpSessionId: SESSION_ID, hostId: null, useSudo: false });
  });

  it("loads suggestions per host and persists new directories as a bounded recent list", async () => {
    invoke.mockResolvedValueOnce([
      ["explorer_recent_host-1", JSON.stringify(["/old", "/srv"])],
      ["explorer_recent_host-2", JSON.stringify(["/other-server"])],
    ]);
    await useSftpStore.getState().loadRecentDirectories("host-1");
    expect(useSftpStore.getState().recentDirectories["host-1"]).toEqual(["/old", "/srv"]);
    const store = useSftpStore.getState();
    store.openSession(SESSION_ID, "ssh-1", "Host", "user", false, "", "host-1");
    store.setEntries(SESSION_ID, "/new", []);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_setting", {
      key: "explorer_recent_host-1", value: JSON.stringify(["/new", "/old", "/srv"]),
    }));
    for (let i = 0; i < 25; i++) store.setEntries(SESSION_ID, `/dir-${i}`, []);
    expect(useSftpStore.getState().recentDirectories["host-1"]).toHaveLength(20);
    expect(useSftpStore.getState().recentDirectories["host-1"][0]).toBe("/dir-24");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_setting", {
      key: "explorer_recent_host-1", value: JSON.stringify(useSftpStore.getState().recentDirectories["host-1"]),
    }));
  });

  it("ignores local drops outside the file browser pane", async () => {
    render(<ExplorerView sessionId={SESSION_ID} />);
    await waitFor(() => expect(dropListener.current).not.toBeNull());
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
    dropListener.current?.({ payload: { type: "drop", paths: ["/local/file.txt"], position: { x: 10, y: 10 } } });
    expect(enqueueCall()).toBeUndefined();
  });

  it("does not enqueue an unchecked overwrite when the destination listing fails", async () => {
    render(<ExplorerView sessionId={SESSION_ID} />);
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.loading).toBe(false));
    await waitFor(() => expect(dropListener.current).not.toBeNull());
    const target = screen.getByLabelText("Current path");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    invoke.mockRejectedValueOnce({ message: "Connection closed" });
    dropListener.current?.({ payload: { type: "drop", paths: ["/local/file.txt"], position: { x: 10, y: 10 } } });
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "sftp_list_dir")).toHaveLength(2));
    expect(enqueueCall()).toBeUndefined();
  });

  it("keeps permission errors visible without reconnecting or changing navigation history", async () => {
    render(<ExplorerView sessionId={SESSION_ID} />);
    await waitFor(() => expect(useSftpStore.getState().sessions.get(SESSION_ID)?.loading).toBe(false));
    invoke.mockImplementation(async (command) => {
      if (command === "sftp_list_dir") throw { message: "Permission denied" };
      return [];
    });
    await navigate("/root");
    await screen.findByText("Permission denied");
    expect(useSftpStore.getState().sessions.get(SESSION_ID)?.currentPath).toBe(CURRENT_PATH);
    expect(invoke.mock.calls.some(([command]) => command === "sftp_reconnect")).toBe(false);
  });
});

describe("download preparation lifecycle", () => {
  const file: SftpEntry = { name: "notes.txt", path: `${CURRENT_PATH}/notes.txt`, entry_type: "File", size: 12, permissions: 0o644, permissions_display: "rw-r--r--", modified: null, is_symlink: false };
  beforeEach(() => {
    invoke.mockReset();
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
    useSftpStore.setState({ sessions: new Map(), activeSftpSessionId: null, clipboard: null, recentDirectories: {} });
    seedSession();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function beginDrag() {
    render(<ExplorerView sessionId={SESSION_ID} />);
    const name = await screen.findByText(file.name);
    const row = name.closest("[data-entry-row]")!;
    fireEvent.pointerDown(row, { button: 0, buttons: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 120, clientY: 100 });
  }

  it("stops Preparing as soon as bytes are ready, without waiting for desktop drag completion", async () => {
    let finishNative!: (value: { dropped: boolean; count: number }) => void;
    const native = new Promise((resolve) => { finishNative = resolve; });
    invoke.mockImplementation(async (command, args) => {
      if (command === "sftp_list_dir") return [file];
      if (command === "sftp_prepare_drag_out") return (args as { preparationId: string }).preparationId;
      if (command === "sftp_start_drag_out") return native;
      return [];
    });
    await beginDrag();
    await screen.findByTestId("explorer-ready-download");
    fireEvent.pointerMove(window, { buttons: 1, clientX: window.innerWidth - 12, clientY: 100 });
    await screen.findByText("Drop files to copy, or press Esc to cancel.");
    expect(screen.queryByText("Preparing files for download…")).not.toBeInTheDocument();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "sftp_prepare_drag_out")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("explorer-cancel-drag"));
    expect(screen.queryByText("Drop files to copy, or press Esc to cancel.")).not.toBeInTheDocument();
    await act(async () => { finishNative({ dropped: false, count: 1 }); await native; });
    await waitFor(() => expect(invoke.mock.calls.some(([cmd]) => cmd === "sftp_cancel_drag_out")).toBe(true));
    expect(screen.queryByTestId("explorer-ready-download")).not.toBeInTheDocument();
  });

  it("reuses prepared bytes after the desktop drag is cancelled", async () => {
    invoke.mockImplementation(async (command, args) => {
      if (command === "sftp_list_dir") return [file];
      if (command === "sftp_prepare_drag_out") return (args as { preparationId: string }).preparationId;
      if (command === "sftp_start_drag_out") return { dropped: false, count: 1 };
      return [];
    });
    await beginDrag();
    await screen.findByTestId("explorer-ready-download");
    fireEvent.pointerMove(window, { buttons: 1, clientX: window.innerWidth - 12, clientY: 100 });
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "sftp_start_drag_out")).toHaveLength(1));
    const ready = await screen.findByTestId("explorer-ready-download");
    expect(screen.queryByText("Preparing files for download…")).not.toBeInTheDocument();
    fireEvent.pointerDown(ready, { button: 0, buttons: 1 });
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "sftp_start_drag_out")).toHaveLength(2));
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "sftp_prepare_drag_out")).toHaveLength(1);
  });

  it("allows Escape to cancel preparation after the pointer gesture has ended", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "sftp_list_dir") return [file];
      if (command === "sftp_prepare_drag_out") return new Promise(() => {});
      return [];
    });
    await beginDrag();
    await screen.findByText("Preparing files for download…");
    fireEvent.pointerMove(window, { buttons: 1, clientX: window.innerWidth - 12, clientY: 100 });
    fireEvent.pointerUp(window, { button: 0 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Preparing files for download…")).not.toBeInTheDocument();
    await waitFor(() => expect(invoke.mock.calls.some(([cmd]) => cmd === "sftp_cancel_drag_out")).toBe(true));
  });

  it("cancels a pending download immediately and ignores its late completion", async () => {
    let finishPreparation!: (id: string) => void;
    const preparation = new Promise<string>((resolve) => { finishPreparation = resolve; });
    invoke.mockImplementation(async (command) => {
      if (command === "sftp_list_dir") return [file];
      if (command === "sftp_prepare_drag_out") return preparation;
      return [];
    });
    await beginDrag();
    await screen.findByText("Preparing files for download…");
    fireEvent.pointerMove(window, { buttons: 1, clientX: window.innerWidth - 12, clientY: 100 });
    fireEvent.click(screen.getByTestId("explorer-cancel-drag"));
    expect(screen.queryByText("Preparing files for download…")).not.toBeInTheDocument();
    const args = invoke.mock.calls.find(([cmd]) => cmd === "sftp_prepare_drag_out")?.[1] as { preparationId: string };
    finishPreparation(args.preparationId);
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "sftp_cancel_drag_out").length).toBeGreaterThanOrEqual(2));
    expect(invoke.mock.calls.some(([cmd]) => cmd === "sftp_start_drag_out")).toBe(false);
    expect(screen.queryByTestId("explorer-ready-download")).not.toBeInTheDocument();
  });
});
