import {
  MCPInitializeResult,
  MCPToolsListResult,
  MCPToolCallResult,
  MCPToolCallParams,
} from "./types";

export interface IMCPServer {
  initialize(): MCPInitializeResult;
  listTools(): MCPToolsListResult;
  callTool(params: MCPToolCallParams): Promise<MCPToolCallResult>;
}