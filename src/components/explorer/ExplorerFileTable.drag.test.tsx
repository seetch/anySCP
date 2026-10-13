import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExplorerFileTable } from "./ExplorerFileTable";
import { createSftpProvider } from "../../providers/sftp-provider";
import type { ExplorerEntry } from "../../types/explorer";

class TestPointerEvent extends MouseEvent {
  readonly pointerId = 1;
}
const file: ExplorerEntry = { name: "notes.txt", id: "/home/notes.txt", entryType: "File", size: 12, modified: null, permissionsDisplay: "rw-r--r--", permissions: 0o644, isSymlink: false, storageClass: null };
const folder: ExplorerEntry = { ...file, name: "folder", id: "/home/folder", entryType: "Directory" };

function table(onDragOut: (entries: ExplorerEntry[], release?: () => void) => Promise<void> = async () => {}) {
  const prepare = vi.fn();
  const cancel = vi.fn();
  const move = vi.fn(async () => {});
  const drag = vi.fn(onDragOut);
  const { container } = render(<ExplorerFileTable provider={createSftpProvider("session")} entries={[file, folder]} currentPath="/home" sortBy="name" sortAsc onSortChange={() => {}} clipboard={null} onSetClipboard={() => {}} onNavigate={() => {}} onDownload={() => {}} onDelete={async () => {}} onPrepareDragOut={prepare} onCancelDragPreparation={cancel} onDragOut={drag} onMoveEntries={move} />);
  const row = container.querySelector('[data-entry-name="notes.txt"]')!;
  return { container, row, prepare, cancel, move, drag };
}

describe("file drag handoff", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("starts preparing inside the browser and keeps the ghost until native handoff", async () => {
    let finish!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { finish = resolve; });
    const view = table(async (_, handoff) => { release = handoff!; await ready; });
    fireEvent.pointerDown(view.row, { button: 0, buttons: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 120, clientY: 100 });
    expect(view.prepare).toHaveBeenCalledWith([file]);
    expect(view.drag).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { buttons: 1, clientX: window.innerWidth - 12, clientY: 100 });
    expect(view.drag).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Move 1 item/)).toBeInTheDocument();
    fireEvent.mouseLeave(document);
    expect(view.drag).toHaveBeenCalledTimes(1);
    act(() => { release(); });
    expect(screen.queryByText(/Move 1 item/)).not.toBeInTheDocument();
    finish();
    await waitFor(() => expect(view.cancel).not.toHaveBeenCalled());
  });

  it("preserves internal folder moves and cancels their unused download preparation", async () => {
    const view = table();
    const target = view.container.querySelector('[data-entry-name="folder"]')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    fireEvent.pointerDown(view.row, { button: 0, buttons: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(window, { button: 0, clientX: 150, clientY: 100 });
    expect(view.move).toHaveBeenCalledWith([file.id], folder.id);
    expect(view.drag).not.toHaveBeenCalled();
    expect(view.cancel).toHaveBeenCalled();
  });

  it("does not download anything on an ordinary selection click", () => {
    const view = table();
    fireEvent.pointerDown(view.row, { button: 0, buttons: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { button: 0, clientX: 100, clientY: 100 });
    expect(view.prepare).not.toHaveBeenCalled();
    expect(view.drag).not.toHaveBeenCalled();
  });
});
