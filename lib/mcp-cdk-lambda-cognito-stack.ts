import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { UserPool } from "aws-cdk-lib/aws-cognito";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import { McpAuthConstruct } from "./constructs/mcp-auth-construct";
import { McpLambdaConstruct } from "./constructs/mcp-lambda-construct";
import { McpApiGatewayConstruct } from "./constructs/mcp-api-gateway-construct";

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
    const authConstruct = new McpAuthConstruct(this, "Auth", {
      serverName,
    });
    this.userPool = authConstruct.result.userPool;

    // Create MCP Lambda function
    const lambdaConstruct = new McpLambdaConstruct(this, "Lambda", {
      serverName,
    });

    // Create API Gateway with OAuth
    const apiGatewayConstruct = new McpApiGatewayConstruct(this, "ApiGateway", {
      serverName,
      lambdaFunction: lambdaConstruct.lambdaFunction,
      userPool: authConstruct.result.userPool,
      resourceServer: authConstruct.result.resourceServer,
      oauthScopes: authConstruct.result.oauthScopes,
      oauthConfig: {
        clientId: authConstruct.result.clientId,
        authUrl: authConstruct.result.authUrl,
        tokenUrl: authConstruct.result.tokenUrl,
        scope: authConstruct.result.oauthScope,
      },
      customDomain: {
        customDomainName,
        certificate,
        hostedZone,
      },
    });

    this.mcpServerUrl = apiGatewayConstruct.result.apiUrl;
    this.oauthMetadataUrl = apiGatewayConstruct.result.metadataUrl;
  }
}
