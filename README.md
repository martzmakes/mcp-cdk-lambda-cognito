# AWS Lambda MCP Server with OAuth 2

A standalone CDK construct that deploys Model Context Protocol (MCP) servers on AWS Lambda with OAuth 2 authorization via Amazon Cognito. This project provides a complete, production-ready infrastructure for running custom MCP servers with secure authentication.

## About This Project

This repository was created as a standalone, reusable CDK construct based on work from [AWS Labs' run-model-context-protocol-servers-with-aws-lambda](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda) project. It focuses specifically on creating a simple, self-contained solution for deploying MCP servers with OAuth 2 authentication without third-party dependencies.

**Blog Post**: Read more about this project at [martzmakes.com](https://martzmakes.com)

## Features

- **Complete OAuth 2 Infrastructure**: Automatically sets up Amazon Cognito User Pool with OAuth 2 flows and self-registration
- **API Gateway Integration**: Creates a REST API with Cognito authorization and proper WWW-Authenticate headers
- **High-Performance Lambda**: ARM64 architecture with 29-second timeout for optimal cost and performance
- **Custom MCP Server**: Uses official `@modelcontextprotocol/sdk` without third-party dependencies
- **RFC 9728 Compliance**: Implements OAuth 2 Protected Resource Metadata for MCP discovery
- **Security Best Practices**: URI-style resource server identifiers, proper scoping, and production-ready security

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
   npm run deploy
   ```

4. **Get your server URL**:
   After deployment, look for the `McpServerUrl` output value.

## Using the Construct

### Basic Usage

```typescript
import { StandaloneMcpServer } from './lib/standalone-mcp-server.js';

const mcpStack = new StandaloneMcpServer(app, "MyMcpServer", {
  env: { account: process.env["CDK_DEFAULT_ACCOUNT"], region: "us-east-1" },
  stackName: "MyMcp-Server",
  serverName: "my-server",
  serverCommand: "node",
  serverArgs: [
    "/var/task/function/my-custom-server.js"
  ],
  nodeModules: ["@modelcontextprotocol/sdk"],
});
```

### Configuration Options

- **serverName**: Unique name for your MCP server (used in OAuth scopes and resource names)
- **serverCommand**: Command to run your MCP server (e.g., "node", "python")
- **serverArgs**: Arguments passed to the server command (typically path to your custom MCP server)
- **nodeModules**: Optional array of Node.js modules to bundle with the Lambda function
- **additionalFiles**: Optional array of files to copy to the Lambda function

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

Use the MCP client SDK with OAuth support:

```typescript
import { StdioServerAdapter } from '@aws/run-mcp-servers-with-aws-lambda';

const client = new McpClient({
  url: 'https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/mcp',
  oauth: {
    authUrl: 'https://your-cognito-domain.auth.us-east-1.amazoncognito.com',
    tokenUrl: 'https://your-cognito-domain.auth.us-east-1.amazoncognito.com/oauth2/token',
    clientId: 'your-client-id',
    scopes: ['https://api.mcp.your-server-name.example.com/your-server-name']
  }
});
```

## Examples

### Dog Facts Server

The included example deploys a custom dog facts MCP server:

```bash
npm run build
cdk deploy DogFactsMcpServer
```

This creates an MCP server that provides dog facts via the Dog API using a custom server implementation (`function/dog-facts-server.ts`).

### Custom Server

To deploy your own MCP server:

1. Create your custom MCP server in the `function/` directory using the `@modelcontextprotocol/sdk`
2. Update `lib/app.ts` with your server configuration pointing to your custom server file
3. Deploy with `npm run deploy`

#### Example Custom Server Structure

```typescript
// function/my-custom-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "my-custom-server",
  version: "1.0.0"
});

// Define your tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Implement your custom logic
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Security

- OAuth 2 with PKCE for interactive clients
- Client credentials flow for automated access
- Cognito User Pool with strong password policies
- API Gateway with proper authorization scopes
- Secrets Manager for credential storage

## Deploying and Using with Claude Code

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
   npm run deploy
   ```

3. **Note the deployment outputs** - you'll need these values:
   - `McpServerUrl`: Your MCP server endpoint
   - `InteractiveOAuthClientId`: Client ID for interactive OAuth
   - `UserPoolId`: Cognito User Pool ID  
   - `IssuerDomain`: OAuth issuer URL
   - `HostedUIUrl`: URL for user registration and login

### Step 2: Register a User Account

Users can now self-register using Cognito's hosted UI:

1. **Open the registration page**: Use the `HostedUIUrl` from the deployment outputs
2. **Create an account**: Click "Sign up" and provide:
   - Email address (will be verified)
   - Password (must meet complexity requirements)
   - Username (optional)
3. **Verify email**: Check your email for a verification code and complete the verification process
4. **Login**: Once verified, you can log in with your credentials

### Step 3: Configure Claude Code

Add the MCP server to your Claude Code configuration file (`~/.config/claude-code/mcp_servers.json` or similar):

```json
{
  "mcpServers": {
    "dog-facts": {
      "url": "https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/mcp",
      "oauth": {
        "method": "resource_owner_password_credentials",
        "authorization_url": "https://mcp-lambda-dog-facts-ACCOUNT.auth.us-east-1.amazoncognito.com/oauth2/authorize",
        "token_url": "https://mcp-lambda-dog-facts-ACCOUNT.auth.us-east-1.amazoncognito.com/oauth2/token",
        "client_id": "your-interactive-client-id",
        "username": "your-registered-username-or-email",
        "password": "your-registered-password",
        "scope": "https://api.mcp.dog-facts.example.com/dog-facts"
      }
    }
  }
}
```

**Note**: Replace the placeholder values with:
- `your-api-id`: From the `McpServerUrl` output
- `ACCOUNT`: Your AWS account ID (visible in the domain prefix)
- `your-interactive-client-id`: From the `InteractiveOAuthClientId` output  
- `your-registered-username-or-email`: The username or email you registered with
- `your-registered-password`: The password you created during registration

### Step 4: Test the Connection

In Claude Code, you should now be able to use the MCP server. Test it by asking Claude to:

1. List available tools: "What tools are available from the dog-facts server?"
2. Use a tool: "Get me some dog facts"

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
  -d "grant_type=password&client_id=your-client-id&username=your-registered-username&password=your-registered-password&scope=https://api.mcp.dog-facts.example.com/dog-facts"

# Use the access token to call your MCP server
curl -H "Authorization: Bearer your-access-token" \
  "https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/mcp"
```

## Cleanup

To remove all resources:

```bash
npm run destroy
```

## Troubleshooting

1. **Deployment fails**: Ensure your AWS credentials have sufficient permissions for CDK deployment
2. **Domain prefix collision**: The construct now uses unique hashes to avoid Cognito domain collisions
3. **OAuth scope issues**: Scopes now use URI format (`https://api.mcp.{server-name}.example.com/{server-name}`)
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