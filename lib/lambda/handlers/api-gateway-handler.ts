import {
  APIGatewayProxyWithCognitoAuthorizerEvent,
  APIGatewayProxyResult,
  Context,
  Handler,
} from "aws-lambda";
import {
  ErrorCode,
  isJSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { handleMcpRequest } from "../mcp/request-handler";
import { IMCPServer } from "../mcp/server-interface";

export function createApiGatewayHandler(server: IMCPServer): Handler {
  return async (
    event: APIGatewayProxyWithCognitoAuthorizerEvent,
    context: Context
  ): Promise<APIGatewayProxyResult> => {
    console.debug("Incoming event:", JSON.stringify(event, null, 2));

    try {
      // Handle CORS preflight
      if (event.httpMethod === "OPTIONS") {
        return {
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
          },
          body: "",
        };
      }

      // Handle GET requests for OAuth discovery
      if (event.httpMethod === "GET") {
        return {
          statusCode: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "WWW-Authenticate": 'Bearer realm="MCP Server", error="invalid_request", error_description="Authentication required"',
          },
          body: JSON.stringify({
            error: "invalid_request",
            error_description: "Authentication required"
          }),
        };
      }

      // Only allow POST requests for JSON-RPC
      if (event.httpMethod !== "POST") {
        return {
          statusCode: 405,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            error: { code: ErrorCode.InvalidRequest, message: "Method Not Allowed" },
            id: null,
          }),
        };
      }

      // Validate content type
      const contentType = event.headers?.["content-type"] || event.headers?.["Content-Type"];
      if (!contentType?.includes("application/json")) {
        return {
          statusCode: 415,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            error: { code: ErrorCode.InvalidRequest, message: "Content-Type must be application/json" },
            id: null,
          }),
        };
      }

      // Parse request body
      if (!event.body) {
        return {
          statusCode: 400,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            error: { code: ErrorCode.ParseError, message: "Empty request body" },
            id: null,
          }),
        };
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            error: { code: ErrorCode.ParseError, message: "Invalid JSON" },
            id: null,
          }),
        };
      }

      // Handle single request or batch requests
      const requests = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
      const responses = [];

      for (const request of requests) {
        if (isJSONRPCRequest(request)) {
          const response = await handleMcpRequest(request, server);
          responses.push(response);
        } else {
          responses.push({
            jsonrpc: "2.0",
            error: { code: ErrorCode.InvalidRequest, message: "Invalid JSON-RPC request" },
            id: null,
          });
        }
      }

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
        body: JSON.stringify(Array.isArray(parsedBody) ? responses : responses[0]),
      };

    } catch (error) {
      console.error("Handler error:", error);
      return {
        statusCode: 500,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          error: { 
            code: ErrorCode.InternalError, 
            message: "Internal server error" 
          },
          id: null,
        }),
      };
    }
  };
}