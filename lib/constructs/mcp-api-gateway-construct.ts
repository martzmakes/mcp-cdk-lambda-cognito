import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  RestApi,
  LambdaIntegration,
  CognitoUserPoolsAuthorizer,
  AuthorizationType,
  Cors,
  GatewayResponse,
  ResponseType,
  MockIntegration,
  AwsIntegration,
  DomainName,
} from "aws-cdk-lib/aws-apigateway";
import {
  UserPool,
  OAuthScope,
  UserPoolResourceServer,
} from "aws-cdk-lib/aws-cognito";
import {
  HostedZone,
  ARecord,
  RecordTarget,
  IHostedZone,
} from "aws-cdk-lib/aws-route53";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  Role,
  ServicePrincipal,
  PolicyStatement,
  Effect,
  PolicyDocument,
} from "aws-cdk-lib/aws-iam";

export interface McpApiGatewayConstructProps {
  serverName: string;
  lambdaFunction: NodejsFunction;
  userPool: UserPool;
  resourceServer: UserPoolResourceServer;
  oauthScopes: OAuthScope[];
  oauthConfig: {
    clientId: string;
    authUrl: string;
    tokenUrl: string;
    scope: string;
  };
  customDomain: {
    customDomainName: string;
    certificate: Certificate;
    hostedZone: IHostedZone;
  };
}

export interface McpApiGatewayResult {
  apiUrl: string;
  metadataUrl: string;
  api: RestApi;
}

export class McpApiGatewayConstruct extends Construct {
  public readonly result: McpApiGatewayResult;

  constructor(
    scope: Construct,
    id: string,
    props: McpApiGatewayConstructProps
  ) {
    super(scope, id);

    const {
      serverName,
      lambdaFunction,
      userPool,
      resourceServer,
      oauthScopes,
      oauthConfig,
      customDomain,
    } = props;

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
        allowHeaders: Cors.DEFAULT_HEADERS.concat(["Authorization"]),
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
    this.createGatewayResponses(api);

    // Add MCP endpoint
    this.createMcpEndpoints(api, lambdaIntegration, cognitoAuthorizer, serverName);

    // Add OAuth metadata endpoints (RFC 9728)
    this.createOAuthMetadataEndpoints(api, serverName, oauthConfig, customDomain);

    // Add Dynamic Client Registration (DCR) endpoint
    this.createDcrEndpoint(api, userPool, serverName);

    // Setup custom domain
    const domainName = this.createCustomDomain(api, customDomain);

    const finalApiUrl = `https://${customDomain.customDomainName}/mcp`;
    const metadataUrl = `https://${customDomain.customDomainName}/.well-known/oauth-protected-resource`;

    // Primary MCP configuration outputs
    new cdk.CfnOutput(this, "McpServerUrl", {
      value: finalApiUrl,
      description: "MCP server URL for Claude Code configuration",
    });

    new cdk.CfnOutput(this, "OAuthMetadataUrl", {
      value: metadataUrl,
      description: "OAuth metadata endpoint (RFC 9728 compliance)",
    });

    new cdk.CfnOutput(this, "ClaudeMcpAddCommand", {
      value: `claude mcp add --transport http ${serverName} ${finalApiUrl}`,
      description:
        "Claude MCP add command - run this, then use /mcp to authenticate with OAuth",
    });

    this.result = {
      apiUrl: finalApiUrl,
      metadataUrl,
      api,
    };
  }

  private createGatewayResponses(api: RestApi) {
    new GatewayResponse(this, "UnauthorizedResponse", {
      restApi: api,
      type: ResponseType.UNAUTHORIZED,
      statusCode: "401",
      responseHeaders: {
        "WWW-Authenticate":
          "'Bearer realm=\"MCP Server\", error=\"invalid_request\"'",
      },
    });

    new GatewayResponse(this, "AccessDeniedResponse", {
      restApi: api,
      type: ResponseType.ACCESS_DENIED,
      statusCode: "403",
      responseHeaders: {
        "WWW-Authenticate":
          "'Bearer realm=\"MCP Server\", error=\"insufficient_scope\"'",
      },
    });
  }

  private createMcpEndpoints(
    api: RestApi,
    lambdaIntegration: LambdaIntegration,
    cognitoAuthorizer: CognitoUserPoolsAuthorizer,
    serverName: string
  ) {
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
  }

  private createOAuthMetadataEndpoints(
    api: RestApi,
    serverName: string,
    oauthConfig: { authUrl: string; tokenUrl: string },
    customDomain: { customDomainName: string }
  ) {
    const wellKnownResource = api.root.addResource(".well-known");

    // OAuth protected resource metadata endpoint (RFC 9728)
    const oauthProtectedResourceResource = wellKnownResource.addResource(
      "oauth-protected-resource"
    );

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
                authorization_servers: [
                  `https://${customDomain.customDomainName}/.well-known/oauth-authorization-server`,
                ],
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

    // OAuth authorization server metadata endpoint (RFC 8414)
    const oauthAuthServerResource = wellKnownResource.addResource(
      "oauth-authorization-server"
    );

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
                issuer: oauthConfig.authUrl.split("/oauth2/authorize")[0],
                authorization_endpoint: oauthConfig.authUrl,
                token_endpoint: oauthConfig.tokenUrl,
                registration_endpoint: `https://${customDomain.customDomainName}/connect/register`,
                response_types_supported: ["code"],
                grant_types_supported: [
                  "authorization_code",
                  "client_credentials",
                ],
                code_challenge_methods_supported: ["S256"],
                scopes_supported: [
                  `mcp-${serverName}/${serverName}`,
                  "openid",
                  "email",
                  "profile",
                ],
                token_endpoint_auth_methods_supported: [
                  "client_secret_post",
                  "client_secret_basic",
                  "none",
                ],
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
  }

  private createDcrEndpoint(api: RestApi, userPool: UserPool, serverName: string) {
    const connectResource = api.root.addResource("connect");
    const registerResource = connectResource.addResource("register");

    // Create IAM role for API Gateway to call Cognito
    const cognitoIntegrationRole = new Role(this, "CognitoIntegrationRole", {
      assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
      inlinePolicies: {
        CognitoAccess: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["cognito-idp:CreateUserPoolClient"],
              resources: [userPool.userPoolArn],
            }),
          ],
        }),
      },
    });

    // Create AWS integration for Cognito CreateUserPoolClient API
    const dcrIntegration = new AwsIntegration({
      service: "cognito-idp",
      action: "CreateUserPoolClient",
      options: {
        credentialsRole: cognitoIntegrationRole,
        requestTemplates: {
          "application/json": `#set($rawName = $input.path('$.client_name'))
#if(!$rawName || $rawName == "")
  #set($rawName = "client")
#end
#set($name1 = $rawName.trim())
#set($name2 = $name1.replaceAll("[^\\\\w\\\\s+=,.@-]", ""))
#set($safeName = $util.escapeJavaScript($name2))
#if($safeName.length() > 128)
  #set($safeName = $safeName.substring(0,128))
#end

#set($cb = $input.json('$.redirect_uris'))
#if(!$cb) #set($cb = '[]') #end
{
  "UserPoolId": "${userPool.userPoolId}",
  "ClientName": "$safeName",
  "CallbackURLs": $cb,
  "AllowedOAuthFlows": ["code"],
  "AllowedOAuthFlowsUserPoolClient": true,
  "AllowedOAuthScopes": ["mcp-${serverName}/${serverName}", "openid", "email", "profile"],
  "SupportedIdentityProviders": ["COGNITO"],
  "GenerateSecret": false
}`,
        },
        integrationResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Content-Type": "'application/json'",
              "method.response.header.Access-Control-Allow-Origin": "'*'",
            },
            responseTemplates: {
              "application/json": `{
                "client_id": $input.json('$.UserPoolClient.ClientId'),
                "client_name": $input.json('$.UserPoolClient.ClientName'),
                "redirect_uris": $input.json('$.UserPoolClient.CallbackURLs'),
                "response_types": ["code"],
                "grant_types": ["authorization_code"],
                "token_endpoint_auth_method": "none",
                "scope": "mcp-${serverName}/${serverName} openid email profile"
              }`,
            },
          },
          {
            statusCode: "400",
            selectionPattern: "4\\\\d{2}",
            responseTemplates: {
              "application/json": `#set($err = $util.parseJson($input.body))
{
  "error": "invalid_request",
  "error_description": "RequestId: $context.requestId | $util.escapeJavaScript($err.message)"
}`,
            },
          },
        ],
      },
    });

    registerResource.addMethod("POST", dcrIntegration, {
      authorizationType: AuthorizationType.NONE,
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Content-Type": true,
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
        {
          statusCode: "400",
          responseParameters: {
            "method.response.header.Content-Type": true,
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    });
  }

  private createCustomDomain(
    api: RestApi,
    customDomain: {
      customDomainName: string;
      certificate: Certificate;
      hostedZone: IHostedZone;
    }
  ): DomainName {
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
      recordName: customDomain.customDomainName.split(".")[0], // "mcp-dogfacts"
      target: RecordTarget.fromAlias(new ApiGatewayDomain(domainName)),
    });

    return domainName;
  }
}