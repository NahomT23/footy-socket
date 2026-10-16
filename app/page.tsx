"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

type LogEntry = {
  id: string;
  at: string;
  direction: string;
  event: string;
  dataType: string;
  bytes: number;
  raw: string;
  socketId: string;
};

type ChatMsg = { id: string; at: string; from: string; text: string };

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState("");
  const [transport, setTransport] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("hello server");
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({ path: "/socket.io" });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setSocketId(socket.id ?? "");
      setTransport(socket.io.engine.transport.name);
    });

    socket.io.engine.on("upgrade", (t) => setTransport(t.name));
    socket.on("disconnect", () => setConnected(false));

    socket.on("log", (entry: LogEntry) => {
      setLogs((prev) => [...prev.slice(-99), entry]);
    });

    socket.on("chat message", (msg: ChatMsg) => {
      setMessages((prev) => [...prev, msg]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  function send() {
    if (!draft.trim()) return;
    socketRef.current?.emit("chat message", draft);
    setDraft("");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8 font-mono text-sm">
      <h1 className="text-xl font-bold">Socket.IO live demo</h1>

      <div className="flex flex-wrap items-center gap-3 rounded border border-zinc-300 p-3 dark:border-zinc-700">
        <span
          className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
        />
        <span>{connected ? "connected" : "disconnected"}</span>
        {socketId && <span className="text-zinc-500">id: {socketId}</span>}
        {transport && <span className="text-zinc-500">transport: {transport}</span>}
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          className="flex-1 rounded border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <button
          onClick={send}
          disabled={!connected}
          className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          send
        </button>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">messages</h2>
        <div className="flex flex-col gap-1 rounded border border-zinc-300 p-3 dark:border-zinc-700">
          {messages.length === 0 && (
            <span className="text-zinc-500">no messages yet — hit send</span>
          )}
          {messages.map((m) => (
            <div key={m.id}>
              <span className="text-zinc-500">[{m.at.slice(11, 19)}]</span>{" "}
              <span className="text-zinc-500">from {m.from.slice(0, 8)}:</span>{" "}
              {m.text}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">
          raw event log ({logs.length})
        </h2>
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded border border-zinc-300 p-3 dark:border-zinc-700">
          {logs.length === 0 && (
            <span className="text-zinc-500">waiting for events…</span>
          )}
          {[...logs].reverse().map((l) => (
            <div key={l.id} className="border-b border-zinc-200 pb-2 dark:border-zinc-800">
              <div className="flex flex-wrap gap-2">
                <span className="text-zinc-500">[{l.at.slice(11, 19)}]</span>
                <span className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">
                  {l.direction}
                </span>
                <span className="font-semibold">{l.event}</span>
                <span className="text-zinc-500">
                  type: {l.dataType} · {l.bytes} bytes
                </span>
              </div>
              <pre className="mt-1 overflow-x-auto text-xs text-zinc-600 dark:text-zinc-400">
                {l.raw}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
