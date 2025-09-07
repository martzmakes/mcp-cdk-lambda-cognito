import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  RestApi,
  LambdaIntegration,
  CognitoUserPoolsAuthorizer,
  AuthorizationType,
  Cors,
  GatewayResponse,
  ResponseType,
  MockIntegration,
} from "aws-cdk-lib/aws-apigateway";
import {
  UserPool,
  OAuthScope,
  ResourceServerScope,
  UserPoolResourceServer,
} from "aws-cdk-lib/aws-cognito";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";

export interface McpCdkLambdaCognitoProps extends cdk.StackProps {
  // Props interface simplified for dog-facts server
}

export class McpCdkLambdaCognitoStack extends cdk.Stack {
  public readonly userPool: UserPool;
  public readonly mcpServerUrl: string;
  public readonly oauthMetadataUrl: string;

  constructor(scope: Construct, id: string, props: McpCdkLambdaCognitoProps) {
    super(scope, id, props);

    const serverName = "dog-facts";

    // Create OAuth/Cognito infrastructure
    const { userPool, resourceServer, oauthScopes } = this.createAuthInfrastructure(serverName);
    this.userPool = userPool;

    // Create MCP Lambda function
    const lambdaFunction = this.createMcpLambdaFunction(serverName);

    // Create API Gateway with OAuth
    const { apiUrl, metadataUrl } = this.createApiGateway(
      lambdaFunction, 
      userPool, 
      resourceServer, 
      oauthScopes,
      serverName
    );
    
    this.mcpServerUrl = apiUrl;
    this.oauthMetadataUrl = metadataUrl;

  }

  private createAuthInfrastructure(serverName: string) {
    // Create Cognito User Pool with self-registration enabled
    const userPool = new UserPool(this, "McpAuthUserPool", {
      userPoolName: `mcp-lambda-${serverName}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cdk.aws_cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });


    // Create User Pool Domain with hash to avoid collisions
    const domainHash = this.node.addr.substring(0, 8);
    const userPoolDomain = userPool.addDomain("McpAuthUserPoolDomain", {
      cognitoDomain: {
        domainPrefix: `mcp-${serverName}-${domainHash}`,
      },
    });

    // Create resource server and scopes
    const resourceServerScope = new ResourceServerScope({
      scopeName: serverName,
      scopeDescription: `Scope for ${serverName} MCP server`,
    });
    
    const resourceServer = new UserPoolResourceServer(this, "ResourceServer", {
      identifier: `https://api.mcp.${serverName}.example.com`,
      userPool: userPool,
      scopes: [resourceServerScope],
    });
    
    const oauthScopes = [OAuthScope.resourceServer(resourceServer, resourceServerScope)];

    // Create OAuth clients
    const interactiveClient = userPool.addClient("InteractiveClient", {
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(60),
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true,
        },
        scopes: [...oauthScopes, OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
        callbackUrls: [
          "http://localhost:9876/callback",
          "http://localhost:6274/oauth/callback", 
          "http://localhost:8090/callback",
          `https://${userPoolDomain.domainName}/oauth2/idpresponse`,
        ],
        logoutUrls: [
          "http://localhost:9876/logout",
          "http://localhost:6274/logout",
          "http://localhost:8090/logout",
        ],
      },
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      supportedIdentityProviders: [cdk.aws_cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    const automatedClient = userPool.addClient("AutomatedClient", {
      generateSecret: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(60),
      oAuth: {
        flows: {
          clientCredentials: true,
        },
        scopes: oauthScopes,
      },
      authFlows: {},
    });

    const automatedClientSecret = new Secret(this, "AutomatedClientSecret", {
      secretName: `mcp-lambda-${serverName}-oauth-client-secret`,
      description: "Client secret for automated MCP client",
      secretStringValue: automatedClient.userPoolClientSecret,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });


    // Outputs
    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
      description: "Cognito User Pool ID",
    });

    new cdk.CfnOutput(this, "IssuerDomain", {
      value: userPool.userPoolProviderUrl,
      description: "Cognito User Pool Issuer URL",
    });

    new cdk.CfnOutput(this, "UserPoolDomain", {
      value: userPoolDomain.domainName,
      description: "Cognito User Pool Domain URL",
    });

    new cdk.CfnOutput(this, "InteractiveOAuthClientId", {
      value: interactiveClient.userPoolClientId,
      description: "Client ID for interactive OAuth flow",
    });

    new cdk.CfnOutput(this, "AutomatedOAuthClientId", {
      value: automatedClient.userPoolClientId,
      description: "Client ID for automated OAuth flow",
    });

    new cdk.CfnOutput(this, "OAuthClientSecretArn", {
      value: automatedClientSecret.secretArn,
      description: "ARN of the secret containing the OAuth client secret",
    });

    new cdk.CfnOutput(this, "HostedUIUrl", {
      value: `https://${userPoolDomain.domainName}/login?client_id=${interactiveClient.userPoolClientId}&response_type=code&scope=openid+email+profile+https%3A%2F%2Fapi.mcp.${serverName}.example.com%2F${serverName}&redirect_uri=http://localhost:9876/callback`,
      description: "Hosted UI login URL for user registration and authentication",
    });

    return { userPool, resourceServer, oauthScopes };
  }

  private createMcpLambdaFunction(serverName: string): NodejsFunction {
    const functionName = `mcp-server-${serverName}`;
    
    // Create log group with AWS standard naming
    const logGroup = new LogGroup(this, "LogGroup", {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Lambda function
    const lambdaFunction = new NodejsFunction(this, "function", {
      entry: path.join(__dirname, "./lambda/mcp.ts"),
      functionName,
      logGroup,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(29),
      architecture: Architecture.ARM_64,
      runtime: Runtime.NODEJS_22_X,
      environment: {
        LOG_LEVEL: "DEBUG",
      },
      bundling: {
        format: OutputFormat.ESM,
        mainFields: ["module", "main"],
      },
    });

    return lambdaFunction;
  }

  private createApiGateway(
    lambdaFunction: NodejsFunction,
    userPool: UserPool,
    _resourceServer: UserPoolResourceServer,
    _oauthScopes: OAuthScope[],
    serverName: string
  ): { apiUrl: string; metadataUrl: string } {
    // Create Lambda integration
    const lambdaIntegration = new LambdaIntegration(lambdaFunction);

    // Create Cognito authorizer
    const cognitoAuthorizer = new CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [userPool],
        identitySource: "method.request.header.Authorization",
        authorizerName: `${serverName}CognitoAuthorizer`,
      }
    );

    // Create API Gateway
    const api = new RestApi(this, "ApiGateway", {
      restApiName: `MCP ${serverName} API Gateway`,
      description: `API Gateway for MCP ${serverName} server with Cognito authorization`,
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      deploy: true,
      cloudWatchRole: false,
    });

    // Configure gateway responses for RFC 9728 compliance
    const metadataUrl = `https://${api.restApiId}.execute-api.${this.region}.amazonaws.com/prod/.well-known/oauth-protected-resource/mcp`;
    
    new GatewayResponse(this, "UnauthorizedResponse", {
      restApi: api,
      type: ResponseType.UNAUTHORIZED,
      statusCode: "401",
      responseHeaders: {
        "WWW-Authenticate": `Bearer error="invalid_request", error_description="No access token was provided in this request", resource_metadata="${metadataUrl}"`,
      },
    });

    new GatewayResponse(this, "AccessDeniedResponse", {
      restApi: api,
      type: ResponseType.ACCESS_DENIED,
      statusCode: "403",
      responseHeaders: {
        "WWW-Authenticate": `Bearer error="insufficient_scope"`,
      },
    });

    // Add MCP endpoint
    const mcpResource = api.root.addResource("mcp");
    mcpResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: [`https://api.mcp.${serverName}.example.com/${serverName}`],
    });

    // Add OAuth protected resource metadata endpoint (RFC 9728)
    const oauthProtectedResourceResource = api.root
      .addResource(".well-known")
      .addResource("oauth-protected-resource")
      .addResource("mcp");

    const apiUrl = `${api.url}mcp`;
    const metadataIntegration = new MockIntegration({
      integrationResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Content-Type": "'application/json'",
            "method.response.header.Access-Control-Allow-Origin": "'*'",
          },
          responseTemplates: {
            "application/json": JSON.stringify(
              {
                resource_name: `${serverName} MCP Server`,
                resource: apiUrl,
                authorization_servers: [userPool.userPoolProviderUrl],
                scopes_supported: [`https://api.mcp.${serverName}.example.com/${serverName}`],
                bearer_methods_supported: ["header"],
              },
              null,
              2
            ),
          },
        },
      ],
      requestTemplates: {
        "application/json": '{"statusCode": 200}',
      },
    });

    oauthProtectedResourceResource.addMethod("GET", metadataIntegration, {
      authorizationType: AuthorizationType.NONE,
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Content-Type": true,
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    });


    // Outputs
    new cdk.CfnOutput(this, "McpServerUrl", {
      value: apiUrl,
      description: `${serverName} MCP Server URL`,
    });

    new cdk.CfnOutput(this, "OAuthMetadataUrl", {
      value: metadataUrl,
      description: "OAuth Protected Resource Metadata URL",
    });

    return { apiUrl, metadataUrl };
  }
}
