import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { IMCPServer } from "./server-interface";
import { MCPToolCallParams } from "./types";

export async function handleMcpRequest(
  request: JSONRPCRequest,
  server: IMCPServer
): Promise<JSONRPCResponse | JSONRPCError> {
  const { jsonrpc, id, method, params } = request;

  try {
    if (method === "initialize") {
      const result = server.initialize();
      return {
        jsonrpc,
        id,
        result
      };
    }

    if (method === "tools/list") {
      const result = server.listTools();
      return {
        jsonrpc,
        id,
        result
      };
    }

    if (method === "tools/call") {
      const toolCallParams = params as unknown as MCPToolCallParams;
      const result = await server.callTool(toolCallParams);
      return {
        jsonrpc,
        id,
        result
      };
    }

    throw new Error(`Unknown method: ${method}`);

  } catch (error) {
    console.error(`Error handling request: ${error}`);
    return {
      jsonrpc,
      id,
      error: {
        code: ErrorCode.InternalError,
        message: error instanceof Error ? error.message : "Internal failure",
      },
    };
  }
}