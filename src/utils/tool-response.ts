import type { McpResponse } from '../types/index.js';

export type ToolStatus = 'success' | 'partial' | 'blocked' | 'running' | 'error';

export interface ToolSuccess<T> {
  ok: true;
  status: Exclude<ToolStatus, 'error'>;
  data: T;
  warnings?: string[];
}

export interface ToolFailure {
  ok: false;
  status: 'blocked' | 'error';
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  blockers?: string[];
  warnings?: string[];
}

export type ToolJson<T> = ToolSuccess<T> | ToolFailure;

export function jsonText<T>(payload: ToolJson<T>): McpResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: payload.ok === false
  };
}

