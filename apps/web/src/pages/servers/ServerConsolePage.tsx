import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as api from "../../lib/api";

interface ConsoleLine {
  message: string;
  timestamp: number;
}

export default function ServerConsolePage() {
  const { id } = useParams<{ id: string }>();
  const [connected, setConnected] = useState(false);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [command, setCommand] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const commandHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, [id]);

  useEffect(() => {
    if (autoScroll) {
      consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws/console/${id}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      addLine("[Console connected]", Date.now());
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "output" || data.type === "log") {
          addLine(data.message, Date.now());
        }
      } catch {
        addLine(event.data, Date.now());
      }
    };

    ws.onclose = () => {
      setConnected(false);
      addLine("[Console disconnected - Reconnecting...]", Date.now());
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      addLine("[Console error]", Date.now());
    };
  }

  function disconnectWebSocket() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  function addLine(message: string, timestamp: number) {
    setLines((prev) => [...prev.slice(-999), { message, timestamp }]);
  }

  function sendCommand() {
    if (!command.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    wsRef.current.send(JSON.stringify({ type: "command", command }));
    commandHistoryRef.current.push(command);
    historyIndexRef.current = commandHistoryRef.current.length;
    setCommand("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      sendCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
        setCommand(commandHistoryRef.current[historyIndexRef.current] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndexRef.current < commandHistoryRef.current.length - 1) {
        historyIndexRef.current++;
        setCommand(commandHistoryRef.current[historyIndexRef.current] || "");
      } else {
        historyIndexRef.current = commandHistoryRef.current.length;
        setCommand("");
      }
    }
  }

  function clearConsole() {
    setLines([]);
  }

  function copyOutput() {
    const text = lines.map(l => l.message).join("\n");
    navigator.clipboard.writeText(text);
  }

  function downloadLogs() {
    const text = lines.map(l => `[${new Date(l.timestamp).toISOString()}] ${l.message}`).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `console-${id}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function stopServer() {
    if (!confirm("Are you sure you want to stop this server?")) return;
    try {
      await api.post(`/servers/${id}/power`, { action: "stop" });
    } catch (err) {
      console.error("Failed to stop server:", err);
    }
  }

  async function restartServer() {
    if (!confirm("Are you sure you want to restart this server?")) return;
    try {
      await api.post(`/servers/${id}/power`, { action: "restart" });
    } catch (err) {
      console.error("Failed to restart server:", err);
    }
  }

  async function killServer() {
    if (!confirm("WARNING: This will forcefully kill the server. Unsaved progress will be lost!")) return;
    try {
      await api.post(`/servers/${id}/power`, { action: "kill" });
    } catch (err) {
      console.error("Failed to kill server:", err);
    }
  }

  return (
    <div className="h-[calc(100vh-12rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Console</h1>
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            connected ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
          }`}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-neutral-700 bg-neutral-800"
            />
            Auto-scroll
          </label>
          
          <button onClick={clearConsole} className="btn btn-secondary text-sm">
            Clear
          </button>
          <button onClick={copyOutput} className="btn btn-secondary text-sm">
            Copy
          </button>
          <button onClick={downloadLogs} className="btn btn-secondary text-sm">
            Download
          </button>
          
          <div className="h-6 w-px bg-neutral-700 mx-2" />
          
          <button onClick={restartServer} className="btn btn-primary text-sm">
            Restart
          </button>
          <button onClick={stopServer} className="btn btn-secondary text-sm">
            Stop
          </button>
          <button onClick={killServer} className="btn btn-danger text-sm">
            Kill
          </button>
        </div>
      </div>

      <div className="flex-1 bg-black border border-neutral-800 rounded-lg overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 font-mono text-sm">
          {lines.length === 0 ? (
            <div className="text-gray-500">No console output yet...</div>
          ) : (
            lines.map((line, index) => (
              <div key={index} className="text-gray-300 whitespace-pre-wrap break-all">
                <span className="text-gray-600 select-none">[{new Date(line.timestamp).toLocaleTimeString()}]</span>{" "}
                {line.message}
              </div>
            ))
          )}
          <div ref={consoleEndRef} />
        </div>

        <div className="border-t border-neutral-800 p-3">
          <div className="flex gap-2">
            <span className="text-green-500 font-mono">&gt;</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command and press Enter..."
              disabled={!connected}
              className="flex-1 bg-transparent border-none outline-none text-white font-mono text-sm"
            />
            <button
              onClick={sendCommand}
              disabled={!connected || !command.trim()}
              className="btn btn-primary text-sm px-4"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
