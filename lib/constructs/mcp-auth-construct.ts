import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  UserPool,
  OAuthScope,
  ResourceServerScope,
  UserPoolResourceServer,
  CfnManagedLoginBranding,
  ManagedLoginVersion,
} from "aws-cdk-lib/aws-cognito";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

export interface McpAuthConstructProps {
  serverName: string;
}

export interface McpAuthResult {
  userPool: UserPool;
  resourceServer: UserPoolResourceServer;
  oauthScopes: OAuthScope[];
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  oauthScope: string;
  signInUrl: string;
}

export class McpAuthConstruct extends Construct {
  public readonly result: McpAuthResult;

  constructor(scope: Construct, id: string, props: McpAuthConstructProps) {
    super(scope, id);

    const { serverName } = props;
    const region = cdk.Stack.of(this).region;

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
      // IMPORTANT: have to use CLASSIC_HOSTED_UI... NEWER_MANAGED_LOGIN does NOT work with DCR
      managedLoginVersion: ManagedLoginVersion.CLASSIC_HOSTED_UI,
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

    const oauthScopes = [
      OAuthScope.resourceServer(resourceServer, resourceServerScope),
    ];

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
        scopes: [
          ...oauthScopes,
          OAuthScope.EMAIL,
          OAuthScope.OPENID,
          OAuthScope.PROFILE,
        ],
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
      supportedIdentityProviders: [
        cdk.aws_cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    // Note: PKCE is automatically enabled for public clients in Cognito
    // The client is already configured as a public client (generateSecret: false)

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

    this.result = {
      userPool,
      resourceServer,
      oauthScopes,
      clientId: interactiveClient.userPoolClientId,
      authUrl: `https://${userPoolDomain.domainName}.auth.${region}.amazoncognito.com/oauth2/authorize`,
      tokenUrl: `https://${userPoolDomain.domainName}.auth.${region}.amazoncognito.com/oauth2/token`,
      oauthScope: `mcp-${serverName}/${serverName}`,
      signInUrl,
    };
  }
}