import { describe, expect, it } from 'vitest';

import {
  HEALTH_PATH,
  LISTEN_HOST,
  LISTEN_PORT,
  MCP_PATH,
  MCP_SESSION_HEADER,
  handleRuntimeRequest,
} from './health.js';

describe('MCP runtime contract', () => {
  it('binds the platform port and accepts the session header on POST /mcp', () => {
    expect(LISTEN_HOST).toBe('0.0.0.0');
    expect(LISTEN_PORT).toBe(8000);
    expect(MCP_PATH).toBe('/mcp');
    expect(MCP_SESSION_HEADER).toBe('Mcp-Session-Id');
    const calls: Array<{
      status: number;
      body: string;
      headers: Readonly<Record<string, string>>;
    }> = [];
    handleRuntimeRequest('POST', '/mcp', 'session-1', (status, body, headers) => {
      calls.push({ status, body, headers });
    });
    expect(calls).toEqual([
      {
        status: 202,
        body: JSON.stringify({ jsonrpc: '2.0', result: { accepted: true } }),
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
      },
    ]);
  });

  it('reports health without storing a session', () => {
    let status = 0;
    handleRuntimeRequest('GET', HEALTH_PATH, undefined, (code) => {
      status = code;
    });
    expect(status).toBe(200);
    handleRuntimeRequest('POST', '/other', undefined, (code) => {
      status = code;
    });
    expect(status).toBe(404);
  });
});
