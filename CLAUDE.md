# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build and Deploy
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to JavaScript
npm run watch        # Watch mode for development
npm test             # Run Jest tests
npx tsc --noEmit     # Type check without emitting files (preferred for CI/validation)
npx cdk deploy       # Deploy the stack to AWS
npx cdk destroy      # Remove all AWS resources
npx cdk diff         # Show differences before deployment
npx cdk synth        # Synthesize CloudFormation template
```

### CDK-Specific Commands
```bash
npx cdk bootstrap    # Bootstrap CDK in your AWS account (one-time setup)
npx cdk ls           # List all stacks
npx cdk doctor       # Check for common CDK issues
```

## Architecture Overview

This is a **standalone CDK construct** that deploys Model Context Protocol (MCP) servers on AWS Lambda with OAuth 2 authorization via Amazon Cognito. The project has been simplified from its original generic form to focus specifically on a **hardcoded dog-facts server**.

### Modular Construct Architecture
The codebase uses a **three-construct pattern** for clear separation of concerns:

#### 1. McpAuthConstruct (`lib/constructs/mcp-auth-construct.ts`) - "The Gatekeeper"
- **Purpose**: Handles all OAuth 2.0 and Cognito authentication infrastructure
- **Inputs**: Only `serverName` required
- **Outputs**: Clean `result` object with auth components (userPool, resourceServer, oauthScopes, etc.)
- **Creates**: Cognito User Pool, OAuth clients (interactive + automated), resource servers, and branding

#### 2. McpLambdaConstruct (`lib/constructs/mcp-lambda-construct.ts`) - "The Worker"
- **Purpose**: Creates the Lambda function that processes MCP requests
- **Inputs**: `serverName` + optional config (memory, timeout, logLevel)
- **Outputs**: Configured `lambdaFunction` ready for API Gateway integration
- **Features**: ARM64 runtime, ESM bundling, CloudWatch logs with 1-day retention

#### 3. McpApiGatewayConstruct (`lib/constructs/mcp-api-gateway-construct.ts`) - "The Gateway"
- **Purpose**: Creates API Gateway with OAuth endpoints, custom domain, and RFC compliance
- **Inputs**: Lambda function, auth components, domain configuration
- **Outputs**: Final API URL and OAuth metadata URL
- **Features**: CORS support, OAuth discovery endpoints, Dynamic Client Registration (DCR)

#### 4. Main Stack (`lib/mcp-cdk-lambda-cognito-stack.ts`) - "The Orchestrator"
- **Purpose**: Composes all constructs with minimal configuration (~78 lines)
- **Pattern**: Auth → Lambda → API Gateway data flow
- **Configuration**: Hardcoded `serverName = "dog-facts"` and custom domain `mcp-dogfacts.martzmakes.com`

#### 5. Lambda Function (`lib/lambda/mcp.ts`)
- **Direct MCP Implementation**: No external process spawning
- **Core Methods**: `initialize`, `tools/list`, `tools/call` for getDogFacts tool
- **Integration**: Direct API calls to `https://dogapi.dog/api/v2/facts`

#### 6. Entry Point (`bin/mcp-cdk-lambda-cognito.ts`)
- Single stack deployment: "StandaloneMcp-DogFacts" in us-east-1

### OAuth 2 Infrastructure
The construct creates complete OAuth 2 infrastructure:
- **Cognito User Pool** with self-registration and hosted UI
- **Two OAuth Clients**:
  - Interactive client (PKCE + hosted UI flows)
  - Automated client (client credentials flow)
- **Resource Server** with URI-style scopes: `https://api.mcp.dog-facts.example.com/dog-facts`
- **API Gateway Authorization** with proper WWW-Authenticate headers for RFC 9728 compliance

### Lambda Configuration
- **Runtime**: Node.js 22.x on ARM64 architecture
- **Memory**: 2048 MB
- **Timeout**: 29 seconds
- **Environment**: LOG_LEVEL=DEBUG
- **Bundling**: ESM format with simplified configuration

## Important Implementation Details

### MCP Protocol Support
The Lambda function implements standard MCP JSON-RPC methods:
- `initialize`: Returns server capabilities and metadata
- `tools/list`: Returns available tools (getDogFacts)
- `tools/call`: Executes the getDogFacts tool with limit parameter (1-10)

### Security and Compliance
- **RFC 9728 Compliance**: OAuth protected resource metadata endpoint
- **CORS Support**: Proper preflight handling and headers
- **Authorization Scopes**: URI-based scope validation
- **Error Handling**: Structured JSON-RPC error responses

### Development Notes
- **No index.ts files**: Direct imports are used instead of barrel exports (e.g., `./constructs/mcp-auth-construct`)
- **TypeScript validation**: Use `npx tsc --noEmit` instead of `npm run build` for type checking
- **Construct pattern**: Each construct exposes a clean interface with minimal required inputs
- **OAuth configuration**: Uses unique domain hash prefixes to avoid Cognito domain collisions  
- **Development mode**: All AWS resources use removal policy DESTROY for easy cleanup
- **Custom domain**: Requires pre-existing Route 53 hosted zone for `martzmakes.com`

### Key Implementation Details
- **Lambda bundling**: ESM format with esbuild, no complex afterBundling steps
- **MCP Protocol**: Standard JSON-RPC implementation with initialize, tools/list, tools/call
- **RFC 9728 compliance**: OAuth protected resource metadata endpoints
- **CORS handling**: Proper preflight support for browser-based clients
- **Error responses**: Structured JSON-RPC error format with appropriate HTTP status codes