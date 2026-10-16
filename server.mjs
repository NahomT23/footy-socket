import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => handle(req, res));

const io = new Server(httpServer, {
  path: "/socket.io",
  cors: { origin: true },
});

function logEntry(direction, event, payload, socketId) {
  let raw;
  try {
    raw = JSON.stringify(payload) ?? String(payload);
  } catch {
    raw = String(payload);
  }
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    direction,
    event,
    dataType:
      payload === null
        ? "null"
        : Array.isArray(payload)
          ? "array"
          : typeof payload,
    bytes: Buffer.byteLength(raw, "utf8"),
    raw,
    socketId,
  };
}

io.on("connection", (socket) => {
  io.emit(
    "log",
    logEntry(
      "server",
      "connection",
      { socketId: socket.id, transport: socket.conn.transport.name },
      socket.id
    )
  );

  socket.onAny((event, ...args) => {
    if (event === "log") return;
    const payload = args.length <= 1 ? args[0] : args;
    io.emit("log", logEntry("client→server", event, payload, socket.id));
  });

  socket.on("chat message", (msg) => {
    io.emit("chat message", {
      id: randomUUID(),
      at: new Date().toISOString(),
      from: socket.id,
      text: msg,
    });
    io.emit(
      "log",
      logEntry(
        "server→client",
        "chat message",
        { text: msg, from: socket.id },
        socket.id
      )
    );
  });

  socket.conn.on("upgrade", (transport) => {
    io.emit(
      "log",
      logEntry(
        "server",
        "transport upgrade",
        { transport: transport.name },
        socket.id
      )
    );
  });

  socket.on("disconnect", (reason) => {
    io.emit("log", logEntry("server", "disconnect", { reason }, socket.id));
  });
});

httpServer.listen(port, () => {
  console.log(
    `> Ready on http://localhost:${port} (${dev ? "development" : "production"})`
  );
});
