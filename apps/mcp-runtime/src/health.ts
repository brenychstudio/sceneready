import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

export const LISTEN_HOST = '0.0.0.0';
export const LISTEN_PORT = 8000;
export const MCP_PATH = '/mcp';
export const HEALTH_PATH = '/health';
export const MCP_SESSION_HEADER = 'Mcp-Session-Id';

export function handleRuntimeRequest(
  method: string | undefined,
  target: string | undefined,
  sessionHeader: string | readonly string[] | undefined,
  respond: (status: number, body: string, headers: Readonly<Record<string, string>>) => void,
): void {
  const path = new URL(target ?? '/', 'http://127.0.0.1').pathname;
  if (method === 'GET' && path === HEALTH_PATH) {
    respond(200, JSON.stringify({ status: 'ok' }), { 'content-type': 'application/json' });
    return;
  }
  if (method === 'POST' && path === MCP_PATH) {
    const session = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (typeof session === 'string' && session.length > 0) {
      headers['mcp-session-id'] = session;
    }
    respond(202, JSON.stringify({ jsonrpc: '2.0', result: { accepted: true } }), headers);
    return;
  }
  respond(404, JSON.stringify({ error: 'not_found' }), { 'content-type': 'application/json' });
}

export function createRuntimeServer(): Server {
  return createServer((request, response) => {
    handleRuntimeRequest(
      request.method,
      request.url,
      request.headers['mcp-session-id'],
      (status, body, headers) => {
        response.writeHead(status, headers);
        response.end(body);
      },
    );
  });
}

export function listen(port = LISTEN_PORT, host = LISTEN_HOST): Server {
  const server = createRuntimeServer();
  server.listen(port, host);
  return server;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  listen();
}
