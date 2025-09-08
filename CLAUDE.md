# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build and Deploy
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to JavaScript
npm run watch        # Watch mode for development
npm test             # Run Jest tests
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

### Key Architectural Changes Made
The codebase has undergone significant simplification:
- **Hardcoded Server**: The `serverName` is now hardcoded as "dog-facts" instead of being configurable
- **Direct Implementation**: The Lambda function (`lib/lambda/mcp.ts`) directly implements dog facts logic instead of spawning separate MCP server processes
- **Simplified Bundling**: Removed complex `afterBundling` steps and external file copying
- **Streamlined Props**: The CDK stack props interface is minimal, removing `nodeModules` and `serverCommand/serverArgs` parameters

### Core Components

#### 1. CDK Stack (`lib/mcp-cdk-lambda-cognito-stack.ts`)
- **Main Stack Class**: `McpCdkLambdaCognitoStack` 
- **Hardcoded Configuration**: `serverName = "dog-facts"` set in constructor
- **Three Main Methods**:
  - `createAuthInfrastructure()`: Sets up Cognito User Pool, OAuth clients, and resource servers
  - `createMcpLambdaFunction()`: Creates the Lambda function with simplified bundling
  - `createApiGateway()`: Sets up API Gateway with Cognito authorization and RFC 9728 compliance

#### 2. Lambda Function (`lib/lambda/mcp.ts`)
- **Direct MCP Implementation**: No longer spawns external processes
- **Simplified Architecture**: ~258 lines vs original ~537 lines
- **Core Functions**:
  - `handleMcpRequest()`: Processes JSON-RPC requests for initialize, tools/list, and tools/call methods
  - Main `handler()`: Direct API Gateway event processing with CORS, validation, and error handling
- **Dog Facts Integration**: Directly calls `https://dogapi.dog/api/v2/facts` API

#### 3. Entry Point (`bin/mcp-cdk-lambda-cognito.ts`)
- Deploys single stack with hardcoded configuration
- Stack name: "StandaloneMcp-DogFacts"
- Target region: us-east-1

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
- The `dog-facts-server.ts` file has been removed as its logic is now integrated directly into `mcp.ts`
- The bundling no longer requires `afterBundling` steps or copying external files
- OAuth configuration uses unique domain hash prefixes to avoid Cognito domain collisions
- All AWS resources use removal policy DESTROY for development convenience