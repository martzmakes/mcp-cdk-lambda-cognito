# MCP Server on AWS Lambda with OAuth 2

A **template and example** showing how to deploy Model Context Protocol (MCP) servers on AWS Lambda with OAuth 2 authorization via Amazon Cognito. This project demonstrates a complete, production-ready infrastructure for running custom MCP servers with secure authentication.

The included **Dog Facts server** serves as a practical example of implementing MCP tools, but this template can be easily customized for any MCP server use case.

## About This Project

This repository was created as a standalone template based on work from [AWS Labs' run-model-context-protocol-servers-with-aws-lambda](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda) project. It provides a **simplified, educational example** showing how to:

- Implement MCP servers directly in Lambda functions
- Set up OAuth 2 authentication with Cognito
- Deploy everything with CDK
- Integrate with Claude Code

**Blog Post**: Read more about this project at [martzmakes.com](https://martzmakes.com)

## What You'll Learn

This template demonstrates:

- **Direct MCP Implementation**: How to implement MCP servers directly in Lambda functions without external processes
- **Complete OAuth 2 Infrastructure**: Automatic setup of Amazon Cognito User Pool with OAuth 2 flows and self-registration
- **API Gateway Integration**: REST API with Cognito authorization and proper WWW-Authenticate headers
- **High-Performance Lambda**: ARM64 architecture with 29-second timeout for optimal cost and performance
- **RFC 9728 Compliance**: OAuth 2 Protected Resource Metadata for MCP discovery
- **Security Best Practices**: URI-style resource server identifiers, proper scoping, and production-ready security
- **CDK Infrastructure as Code**: Complete infrastructure deployment with AWS CDK
- **Claude Code Integration**: Step-by-step setup for connecting to Claude Code

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure AWS CLI**:
   ```bash
   aws configure
   ```

3. **Build and deploy**:
   ```bash
   npm run build
   npx cdk deploy
   ```

4. **Get your server URL**:
   After deployment, look for the `McpServerUrl` output value.

## Example: Dog Facts MCP Server

This template includes a **Dog Facts MCP server** as a working example that provides one tool:

### Available Tool
- **getDogFacts**: Get random facts about dogs
  - **Parameters**: 
    - `limit` (optional): Number of facts to return (1-10, default: 5)
  - **Returns**: Formatted list of dog facts from the Dog API

### Implementation Structure
The project now uses a **modular architecture** with clear separation of concerns:

#### Core Architecture (`lib/lambda/`)
- **`mcp.ts`**: Main entry point that instantiates and wires components
- **`handlers/api-gateway-handler.ts`**: HTTP request/response handling with CORS and OAuth support
- **`mcp/request-handler.ts`**: JSON-RPC request processing and routing
- **`mcp/server-interface.ts`**: TypeScript interface defining MCP server contract
- **`mcp/types.ts`**: Shared type definitions for MCP protocol compliance

#### Dog Facts Server Implementation (`lib/lambda/servers/dog-facts/`)
- **`server.ts`**: Complete DogFactsServer class implementing IMCPServer interface
- **`types.ts`**: Type definitions specific to Dog API integration

This architecture demonstrates:
- **Modular Design**: Each component has a single responsibility
- **Type Safety**: Full TypeScript coverage with proper interfaces
- **Protocol Compliance**: Standard MCP methods (`initialize`, `tools/list`, `tools/call`)
- **External API Integration**: Clean separation of API calls and response formatting
- **Error Handling**: Structured JSON-RPC error responses
- **Extensibility**: Easy to add new MCP servers alongside the dog-facts example

## Customizing for Your Use Case

The modular architecture makes it easy to create your own MCP servers:

### Option 1: Create a New Server (Recommended)

1. **Create your server implementation** in `lib/lambda/servers/your-server/`:
   ```typescript
   // lib/lambda/servers/your-server/server.ts
   import { IMCPServer } from "../../mcp/server-interface";
   
   export class YourServer implements IMCPServer {
     initialize() { /* your implementation */ }
     listTools() { /* your tools */ }
     async callTool(params) { /* your logic */ }
   }
   ```

2. **Add server-specific types** in `lib/lambda/servers/your-server/types.ts`

3. **Update the main entry point** (`lib/lambda/mcp.ts`):
   ```typescript
   import { YourServer } from "./servers/your-server/server";
   const yourServer = new YourServer();
   export const handler = createApiGatewayHandler(yourServer);
   ```

4. **Update the CDK stack** (`lib/mcp-cdk-lambda-cognito-stack.ts`):
   - Change `serverName` from "dog-facts" to your service name
   - Update OAuth scopes and resource identifiers

### Option 2: Modify the Existing Dog Facts Server

1. **Update the server class** (`lib/lambda/servers/dog-facts/server.ts`):
   - Modify the `listTools()` method to return your tools
   - Implement your business logic in the `callTool()` method
   - Update server metadata in the `initialize()` method

2. **Add your types** to `lib/lambda/servers/dog-facts/types.ts`

### Benefits of the Modular Architecture

- **Clean Separation**: Protocol handling is separate from business logic
- **Reusability**: The `createApiGatewayHandler` can be used with any IMCPServer
- **Type Safety**: Full TypeScript support with proper interfaces
- **Testing**: Each component can be unit tested independently
- **Multiple Servers**: Easy to deploy different servers by changing the import in `mcp.ts`

### Authentication

The construct creates:

1. **Cognito User Pool** with self-registration enabled and hosted UI
2. **OAuth 2 Clients**:
   - Interactive client for browser-based flows (PKCE + hosted UI)
   - Automated client for machine-to-machine access (client credentials)
3. **Resource Server** with URI-style scopes specific to your MCP server

### Accessing Your MCP Server

After deployment, you'll get several outputs:

- **McpServerUrl**: The main MCP server endpoint
- **OAuthMetadataUrl**: OAuth metadata endpoint for discovery
- **InteractiveOAuthClientId**: Client ID for interactive flows
- **AutomatedOAuthClientId**: Client ID for automated flows
- **HostedUIUrl**: Direct link for user registration and authentication

### Client Integration

The deployed dog facts server uses the scope: `mcp-dog-facts/dog-facts`

You can integrate with the server using MCP client libraries that support OAuth 2 authentication.

## Try the Example

Deploy the included dog facts MCP server to see the template in action:

```bash
npm install
npm run build
npx cdk deploy
```

This creates a complete MCP server infrastructure demonstrating:
- Dog facts functionality via the Dog API (the example implementation)
- OAuth 2 authentication via Cognito
- API Gateway with proper authorization
- Lambda function running on ARM64
- Full integration with Claude Code

Once you understand how it works, customize it for your own MCP server needs!

## Security

- OAuth 2 with PKCE for interactive clients
- Client credentials flow for automated access
- Cognito User Pool with strong password policies
- API Gateway with proper authorization scopes
- Secrets Manager for credential storage

## Step-by-Step: Deploy and Connect to Claude Code

This template provides a complete walkthrough for deploying your MCP server and connecting it to Claude Code.

### Step 1: Deploy the MCP Server

1. **Configure AWS CLI** with appropriate credentials:
   ```bash
   aws configure
   # or use AWS SSO
   aws sso login --profile your-profile
   ```

2. **Install dependencies and deploy**:
   ```bash
   npm install
   npm run build
   npx cdk deploy
   ```

3. **Note the deployment outputs** - you'll need these values:
   - `McpServerUrl`: Your MCP server endpoint
   - `McpOAuthAuthorizationUrl`: OAuth authorization URL
   - `McpOAuthTokenUrl`: OAuth token URL
   - `McpOAuthClientId`: OAuth client ID
   - `McpOAuthScope`: OAuth scope
   - `SignInUrl`: User registration and sign-in URL

### Step 2: Register a User Account

Users can now self-register using Cognito's hosted UI:

1. **Open the registration page**: Use the `SignInUrl` from the deployment outputs
2. **Create an account**: Click "Sign up" and provide:
   - Email address (this will be your username)
   - Password (must meet complexity requirements)
3. **Verify email**: Check your email for a verification code and complete the verification process
4. **Login**: Once verified, you can log in with your credentials

### Step 3: Configure Claude Code

Add the MCP server to your Claude Code configuration file (`~/.config/claude-code/mcp_servers.json` or similar):

```json
{
  "mcpServers": {
    "dog-facts": {
      "url": "[McpServerUrl from deployment outputs]",
      "oauth": {
        "method": "resource_owner_password_credentials",
        "authorization_url": "[McpOAuthAuthorizationUrl from deployment outputs]",
        "token_url": "[McpOAuthTokenUrl from deployment outputs]",
        "client_id": "[McpOAuthClientId from deployment outputs]",
        "username": "your-registered-email@example.com",
        "password": "your-registered-password",
        "scope": "[McpOAuthScope from deployment outputs]"
      }
    }
  }
}
```

**Note**: Replace the bracketed values with the corresponding outputs from your CDK deployment, and update:
- `your-registered-email@example.com`: The email address you registered with
- `your-registered-password`: The password you created during registration

### Step 4: Test the Connection

In Claude Code, you should now be able to use the MCP server. Test it by asking Claude to:

1. **List available tools**: "What tools are available from the dog-facts server?"
2. **Use the tool**: "Get me some dog facts" or "Get me 3 dog facts"
3. **Test with parameters**: "Get me 8 dog facts" (tests the limit parameter)

### Common Issues and Solutions

- **Authentication Failed**: Ensure your username/email and password are correct and the account is verified
- **Scope Error**: Make sure the scope in your configuration exactly matches: `mcp-dog-facts/dog-facts`
- **URL Issues**: Replace all placeholder values (your-api-id, ACCOUNT) with actual values from the deployment outputs
- **Token Expired**: OAuth tokens have limited lifetimes; Claude Code should automatically refresh them

### Authentication Flow Details

The deployment creates two OAuth clients and enables self-registration:

1. **Interactive Client** (PKCE + Hosted UI): For user authentication
   - **Hosted UI**: Users can register and login via Cognito's hosted pages
   - **Self-Registration**: New users can create accounts directly
   - **Email Verification**: Email addresses are automatically verified
   - Supports authorization code flow with PKCE and implicit grant
   - Includes standard OAuth scopes (openid, email, profile) plus MCP resource server scope

2. **Automated Client** (Client Credentials): For machine-to-machine access
   - Client secret stored in AWS Secrets Manager
   - Use for programmatic access without user interaction

### Example: Manual OAuth Testing

You can test OAuth authentication manually using curl:

```bash
# Get access token using resource owner password credentials  
curl -X POST "https://your-cognito-domain.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=your-client-id&username=your-registered-email&password=your-registered-password&scope=mcp-dog-facts/dog-facts"

# Use the access token to call your MCP server
curl -H "Authorization: Bearer your-access-token" \
  "https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/mcp"
```

## Cleanup

To remove all resources:

```bash
npx cdk destroy
```

## Troubleshooting

1. **Deployment fails**: Ensure your AWS credentials have sufficient permissions for CDK deployment
2. **Domain prefix collision**: The construct now uses unique hashes to avoid Cognito domain collisions
3. **OAuth scope issues**: Scopes use the format `mcp-{server-name}/{server-name}`
4. **Performance issues**: Lambda uses ARM64 architecture with 29s timeout for optimal performance

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   MCP Client    │───▶│   API Gateway    │───▶│  Lambda Function│
│                 │    │  (with Cognito   │    │   (MCP Server)  │
│                 │    │  Authorization)  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │  Cognito User    │
                       │      Pool        │
                       └──────────────────┘
```

The construct creates a complete OAuth 2 infrastructure with:
- Cognito User Pool for user management
- API Gateway for HTTP routing and authorization
- Lambda function running your MCP server
- Proper OAuth 2 metadata endpoints for discovery