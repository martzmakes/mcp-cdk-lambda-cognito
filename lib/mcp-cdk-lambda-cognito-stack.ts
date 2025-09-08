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
  CfnManagedLoginBranding,
  ManagedLoginVersion,
} from "aws-cdk-lib/aws-cognito";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { HostedZone, ARecord, RecordTarget, IHostedZone } from "aws-cdk-lib/aws-route53";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import { DomainName } from "aws-cdk-lib/aws-apigateway";
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
    const customDomainName = `mcp-dogfacts.martzmakes.com`;

    // Look up the existing hosted zone
    const hostedZone = HostedZone.fromLookup(this, "HostedZone", {
      domainName: "martzmakes.com",
    });

    // Create ACM certificate for the custom domain
    const certificate = new Certificate(this, "Certificate", {
      domainName: customDomainName,
      validation: CertificateValidation.fromDns(hostedZone),
    });

    // Create OAuth/Cognito infrastructure
    const { userPool, resourceServer, oauthScopes, clientId, authUrl, tokenUrl, oauthScope } = this.createAuthInfrastructure(serverName);
    this.userPool = userPool;

    // Create MCP Lambda function
    const lambdaFunction = this.createMcpLambdaFunction(serverName);

    // Create API Gateway with OAuth
    const { apiUrl, metadataUrl } = this.createApiGateway(
      lambdaFunction, 
      userPool, 
      resourceServer, 
      oauthScopes,
      serverName,
      { clientId, authUrl, tokenUrl, scope: oauthScope },
      { customDomainName, certificate, hostedZone }
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
      },
      signInCaseSensitive: false,
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
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
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    // Create resource server and scopes
    const resourceServerScope = new ResourceServerScope({
      scopeName: serverName,
      scopeDescription: `Scope for ${serverName} MCP server`,
    });
    
    const resourceServer = new UserPoolResourceServer(this, "ResourceServer", {
      identifier: `mcp-${serverName}`,
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

    // Store automated client secret for potential future use
    new Secret(this, "AutomatedClientSecret", {
      secretName: `mcp-lambda-${serverName}-oauth-client-secret`,
      description: "Client secret for automated MCP client",
      secretStringValue: automatedClient.userPoolClientSecret,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add managed login branding for better sign-in experience
    new CfnManagedLoginBranding(this, "ManagedLoginBranding", {
      userPoolId: userPool.userPoolId,
      clientId: interactiveClient.userPoolClientId,
      returnMergedResources: true,
      useCognitoProvidedValues: true,
    });

    // Generate proper sign-in URL
    const homeUrl = "http://localhost:9876/callback";
    const signInUrl = userPoolDomain.signInUrl(interactiveClient, {
      redirectUri: homeUrl,
    });


    // Keep only the essential sign-in URL for user registration
    new cdk.CfnOutput(this, "SignInUrl", {
      value: signInUrl,
      description: "User registration and sign-in URL",
    });


    return { 
      userPool, 
      resourceServer, 
      oauthScopes, 
      clientId: interactiveClient.userPoolClientId,
      authUrl: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/oauth2/authorize`,
      tokenUrl: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/oauth2/token`,
      oauthScope: `mcp-${serverName}/${serverName}`
    };
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
    serverName: string,
    oauthConfig: { clientId: string; authUrl: string; tokenUrl: string; scope: string },
    customDomain: { customDomainName: string; certificate: Certificate; hostedZone: IHostedZone }
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
        allowHeaders: Cors.DEFAULT_HEADERS.concat(['Authorization']),
      },
      deploy: true,
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      cloudWatchRole: false,
    });

    // Configure gateway responses for RFC 9728 compliance
    
    new GatewayResponse(this, "UnauthorizedResponse", {
      restApi: api,
      type: ResponseType.UNAUTHORIZED,
      statusCode: "401",
      responseHeaders: {
        "WWW-Authenticate": "'Bearer realm=\"MCP Server\", error=\"invalid_request\"'",
      },
    });

    new GatewayResponse(this, "AccessDeniedResponse", {
      restApi: api,
      type: ResponseType.ACCESS_DENIED,
      statusCode: "403",
      responseHeaders: {
        "WWW-Authenticate": "'Bearer realm=\"MCP Server\", error=\"insufficient_scope\"'",
      },
    });

    // Add MCP endpoint
    const mcpResource = api.root.addResource("mcp");
    
    // Allow GET requests without authentication for OAuth discovery
    mcpResource.addMethod("GET", lambdaIntegration, {
      authorizationType: AuthorizationType.NONE,
    });
    
    // Require authentication for POST requests (actual MCP communication)
    mcpResource.addMethod("POST", lambdaIntegration, {
      authorizationType: AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: [`mcp-${serverName}/${serverName}`],
    });

    // Add OAuth protected resource metadata endpoint (RFC 9728)
    const wellKnownResource = api.root.addResource(".well-known");
    const oauthProtectedResourceResource = wellKnownResource
      .addResource("oauth-protected-resource");

    const finalApiUrl = `https://${customDomain.customDomainName}/mcp`;
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
                resource: finalApiUrl,
                authorization_servers: [userPool.userPoolProviderUrl],
                scopes_supported: [`mcp-${serverName}/${serverName}`],
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

    // Add OAuth authorization server metadata endpoint (RFC 8414)
    const oauthAuthServerResource = wellKnownResource.addResource("oauth-authorization-server");

    const authServerMetadataIntegration = new MockIntegration({
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
                issuer: oauthConfig.authUrl.split('/oauth2/authorize')[0],
                authorization_endpoint: oauthConfig.authUrl,
                token_endpoint: oauthConfig.tokenUrl,
                response_types_supported: ["code"],
                grant_types_supported: ["authorization_code", "client_credentials"],
                code_challenge_methods_supported: ["S256"],
                scopes_supported: [`mcp-${serverName}/${serverName}`, "openid", "email", "profile"],
                token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"]
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

    oauthAuthServerResource.addMethod("GET", authServerMetadataIntegration, {
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

    // Create custom domain
    const domainName = new DomainName(this, "CustomDomain", {
      domainName: customDomain.customDomainName,
      certificate: customDomain.certificate,
    });

    // Map custom domain to API Gateway (using default stage)
    domainName.addBasePathMapping(api);

    // Create DNS record for custom domain
    new ARecord(this, "CustomDomainRecord", {
      zone: customDomain.hostedZone,
      recordName: customDomain.customDomainName.split('.')[0], // "mcp-dogfacts"
      target: RecordTarget.fromAlias(new ApiGatewayDomain(domainName)),
    });

    // Primary MCP configuration outputs
    new cdk.CfnOutput(this, "McpServerUrl", {
      value: finalApiUrl,
      description: "MCP server URL for Claude Code configuration",
    });

    new cdk.CfnOutput(this, "OAuthMetadataUrl", {
      value: `https://${customDomain.customDomainName}/.well-known/oauth-protected-resource`,
      description: "OAuth metadata endpoint (RFC 9728 compliance)",
    });

    new cdk.CfnOutput(this, "ClaudeMcpAddCommand", {
      value: `claude mcp add --transport http ${serverName} ${finalApiUrl}`,
      description: "Claude MCP add command - run this, then use /mcp to authenticate with OAuth",
    });

    return { 
      apiUrl: finalApiUrl, 
      metadataUrl: `https://${customDomain.customDomainName}/.well-known/oauth-protected-resource` 
    };
  }
}
