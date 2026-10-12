import "./App.css";
import { ExplorerTerminalWindow } from "./components/terminal/ExplorerTerminal";
import { AppShell } from "./components/layout";

function App() {
  const params = new URLSearchParams(window.location.search);
  const hostId = params.get("terminal_host");
  if (hostId) return <ExplorerTerminalWindow hostId={hostId} path={params.get("terminal_path") ?? "/"} />;
  return <AppShell />;
}

export default App;
