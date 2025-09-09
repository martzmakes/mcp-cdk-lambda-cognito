import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
} from "@modelcontextprotocol/sdk/types.js";

export interface MCPServerInfo {
  name: string;
  version: string;
}

export interface MCPServerCapabilities {
  tools?: object;
  resources?: object;
  prompts?: object;
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: MCPServerCapabilities;
  serverInfo: MCPServerInfo;
  [key: string]: unknown;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, any>;
    additionalProperties?: boolean;
  };
}

export interface MCPToolsListResult {
  tools: MCPTool[];
  [key: string]: unknown;
}

export interface MCPToolCallResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  [key: string]: unknown;
}

export interface MCPToolCallParams {
  name: string;
  arguments?: any;
}

export { JSONRPCRequest, JSONRPCResponse, JSONRPCError };