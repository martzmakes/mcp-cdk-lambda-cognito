import {
  Handler,
  Context,
  APIGatewayProxyWithCognitoAuthorizerEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  JSONRPCError,
  JSONRPCRequest,
  JSONRPCResponse,
  ErrorCode,
  isJSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";

// Dog Facts API types
interface DogFact {
  id: string;
  type: string;
  attributes: {
    body: string;
  };
}

interface DogFactsResponse {
  data: DogFact[];
  links: {
    next?: string;
    prev?: string;
  };
}

// Handle MCP JSON-RPC requests
async function handleMcpRequest(request: JSONRPCRequest): Promise<JSONRPCResponse | JSONRPCError> {
  const { jsonrpc, id, method, params } = request;

  try {
    if (method === "initialize") {
      return {
        jsonrpc,
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "dog-facts-server", version: "1.0.0" }
        }
      };
    }

    if (method === "tools/list") {
      return {
        jsonrpc,
        id,
        result: {
          tools: [{
            name: "getDogFacts",
            description: "Get random facts about dogs",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description: "Maximum number of facts to return (default: 5, max: 10)",
                  minimum: 1,
                  maximum: 10,
                  default: 5
                }
              },
              additionalProperties: false
            }
          }]
        }
      };
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params as { name: string; arguments?: any };
      
      if (name === "getDogFacts") {
        const limit = Math.min(Math.max((args?.limit as number) || 5, 1), 10);
        
        const response = await fetch(`https://dogapi.dog/api/v2/facts?limit=${limit}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data: DogFactsResponse = await response.json() as DogFactsResponse;
        const facts = data.data.map(fact => fact.attributes.body);
        
        return {
          jsonrpc,
          id,
          result: {
            content: [{
              type: "text",
              text: `Here ${facts.length === 1 ? 'is' : 'are'} ${facts.length} dog fact${facts.length === 1 ? '' : 's'}:\n\n${facts.map((fact, index) => `${index + 1}. ${fact}`).join('\n\n')}`
            }]
          }
        };
      }
      
      throw new Error(`Unknown tool: ${name}`);
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

export const handler: Handler = async (
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
        const response = await handleMcpRequest(request);
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