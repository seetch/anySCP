import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSftpStore } from "../../stores/sftp-store";
import { ExplorerPage } from "./ExplorerPage";

const { invoke, isMaximized, isFullscreen } = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  isFullscreen: vi.fn(async () => false),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized, isFullscreen }) }));
vi.mock("./ExplorerView", () => ({ ExplorerView: () => <div>File browser</div> }));
vi.mock("../terminal/ExplorerTerminal", () => ({ ExplorerTerminal: ({ path, onClose }: { path: string; onClose: () => void }) => <div data-testid="console">{path}<button onClick={onClose}>Close console</button></div> }));

describe("file browser SSH terminal", () => {
  beforeEach(() => {
    invoke.mockClear();
    isMaximized.mockResolvedValue(false);
    isFullscreen.mockResolvedValue(false);
    useSftpStore.setState({ sessions: new Map(), activeSftpSessionId: null, recentDirectories: {} });
    useSftpStore.getState().openSession("sftp-1", "ssh-1", "Server", "user", false, "", "host-1");
    useSftpStore.getState().setEntries("sftp-1", "/srv/project", []);
  });

  it("opens a separate application window in the current directory", async () => {
    render(<ExplorerPage sftpSessionId="sftp-1" />);
    fireEvent.click(screen.getByTestId("explorer-terminal"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_explorer_terminal_window", { hostId: "host-1", path: "/srv/project" }));
    expect(screen.queryByTestId("console")).not.toBeInTheDocument();
  });

  it.each(["maximized", "fullscreen"])("docks the console on the right when %s", async (mode) => {
    if (mode === "maximized") isMaximized.mockResolvedValue(true);
    else isFullscreen.mockResolvedValue(true);
    render(<ExplorerPage sftpSessionId="sftp-1" />);
    fireEvent.click(screen.getByTestId("explorer-terminal"));
    expect(await screen.findByTestId("console")).toHaveTextContent("/srv/project");
    expect(invoke).not.toHaveBeenCalledWith("open_explorer_terminal_window", expect.anything());
    fireEvent.click(screen.getByText("Close console"));
    expect(screen.queryByTestId("console")).not.toBeInTheDocument();
  });
});
