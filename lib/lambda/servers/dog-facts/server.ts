import { IMCPServer } from "../../mcp/server-interface";
import {
  MCPInitializeResult,
  MCPToolsListResult,
  MCPToolCallResult,
  MCPToolCallParams,
} from "../../mcp/types";
import { DogFactsResponse } from "./types";

export class DogFactsServer implements IMCPServer {
  initialize(): MCPInitializeResult {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "dog-facts-server", version: "1.0.0" }
    };
  }

  listTools(): MCPToolsListResult {
    return {
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
    };
  }

  async callTool(params: MCPToolCallParams): Promise<MCPToolCallResult> {
    const { name, arguments: args } = params;
    
    if (name === "getDogFacts") {
      const limit = Math.min(Math.max((args?.limit as number) || 5, 1), 10);
      
      const response = await fetch(`https://dogapi.dog/api/v2/facts?limit=${limit}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: DogFactsResponse = await response.json() as DogFactsResponse;
      const facts = data.data.map(fact => fact.attributes.body);
      
      return {
        content: [{
          type: "text",
          text: `Here ${facts.length === 1 ? 'is' : 'are'} ${facts.length} dog fact${facts.length === 1 ? '' : 's'}:\n\n${facts.map((fact, index) => `${index + 1}. ${fact}`).join('\n\n')}`
        }]
      };
    }
    
    throw new Error(`Unknown tool: ${name}`);
  }
}