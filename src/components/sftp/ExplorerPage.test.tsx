import "@testing-library/jest-dom/vitest";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSftpStore } from "../../stores/sftp-store";
import { ExplorerPage } from "./ExplorerPage";

const { invoke, isMaximized, isFullscreen, terminalMount, terminalUnmount } = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]) => {}),
  isMaximized: vi.fn(async () => false),
  isFullscreen: vi.fn(async () => false),
  terminalMount: vi.fn(),
  terminalUnmount: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized, isFullscreen }) }));
vi.mock("./ExplorerView", () => ({ ExplorerView: () => <div>File browser</div> }));
vi.mock("../terminal/ExplorerTerminal", () => ({ ExplorerTerminal: ({ path, onClose }: { path: string; onClose: () => void }) => {
  useEffect(() => {
    terminalMount();
    return () => { terminalUnmount(); };
  }, []);
  return <div data-testid="console">{path}<button onClick={onClose}>Close console</button></div>;
} }));

describe("file browser SSH terminal", () => {
  beforeEach(() => {
    invoke.mockClear();
    terminalMount.mockClear();
    terminalUnmount.mockClear();
    isMaximized.mockResolvedValue(false);
    isFullscreen.mockResolvedValue(false);
    useSftpStore.setState({ sessions: new Map(), activeSftpSessionId: null, recentDirectories: {} });
    useSftpStore.getState().openSession("sftp-1", "ssh-1", "Server", "user", false, "", "host-1");
    useSftpStore.getState().setEntries("sftp-1", "/srv/project", []);
  });

  it("opens a separate application window in the current directory", async () => {
    render(<ExplorerPage sftpSessionId="sftp-1" />);
    fireEvent.click(screen.getByTestId("explorer-terminal"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_explorer_terminal_window", { explorerSessionId: "sftp-1", hostId: "host-1", path: "/srv/project" }));
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
    expect(screen.getByTestId("console")).not.toBeVisible();
    expect(terminalUnmount).not.toHaveBeenCalled();
  });

  it("shows the same docked session again, preserving its original directory until the tab closes", async () => {
    isMaximized.mockResolvedValue(true);
    const { unmount } = render(<ExplorerPage sftpSessionId="sftp-1" />);
    const toggle = screen.getByTestId("explorer-terminal");
    fireEvent.click(toggle);
    expect(await screen.findByTestId("console")).toBeVisible();
    await waitFor(() => expect(terminalMount).toHaveBeenCalledTimes(1));
    fireEvent.click(toggle);
    expect(screen.getByTestId("console")).not.toBeVisible();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    useSftpStore.getState().setEntries("sftp-1", "/other-directory", []);
    fireEvent.click(toggle);
    expect(screen.getByTestId("console")).toBeVisible();
    expect(screen.getByTestId("console")).toHaveTextContent("/srv/project");
    expect(terminalMount).toHaveBeenCalledTimes(1);
    expect(terminalUnmount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Close console"));
    fireEvent.click(toggle);
    expect(screen.getByTestId("console")).toBeVisible();
    expect(terminalMount).toHaveBeenCalledTimes(1);
    unmount();
    expect(terminalUnmount).toHaveBeenCalledTimes(1);
  });

  it("keeps toggling the same detached window even if the main window becomes maximized", async () => {
    const { unmount } = render(<ExplorerPage sftpSessionId="sftp-1" />);
    const toggle = screen.getByTestId("explorer-terminal");
    const countToggles = () => invoke.mock.calls.filter(([command]) => command === "open_explorer_terminal_window").length;
    fireEvent.click(toggle);
    await waitFor(() => expect(countToggles()).toBe(1));
    await waitFor(() => expect(toggle).toBeEnabled());
    isMaximized.mockResolvedValue(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(countToggles()).toBe(2));
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(countToggles()).toBe(3));
    expect(screen.queryByTestId("console")).not.toBeInTheDocument();
    expect(invoke.mock.calls.filter(([command]) => command === "open_explorer_terminal_window").map((call) => call[1])).toEqual(Array(3).fill({ explorerSessionId: "sftp-1", hostId: "host-1", path: "/srv/project" }));
    unmount();
    expect(invoke).toHaveBeenCalledWith("close_explorer_terminal_window", { explorerSessionId: "sftp-1" });
  });
});
