import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import * as path from "path";

export interface McpLambdaConstructProps {
  serverName: string;
  logLevel?: string;
  memorySize?: number;
  timeout?: cdk.Duration;
}

export class McpLambdaConstruct extends Construct {
  public readonly lambdaFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: McpLambdaConstructProps) {
    super(scope, id);

    const {
      serverName,
      logLevel = "DEBUG",
      memorySize = 2048,
      timeout = cdk.Duration.seconds(29),
    } = props;

    const functionName = `mcp-server-${serverName}`;

    // Create log group with AWS standard naming
    const logGroup = new LogGroup(this, "LogGroup", {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Lambda function
    this.lambdaFunction = new NodejsFunction(this, "function", {
      entry: path.join(__dirname, "../lambda/mcp.ts"),
      functionName,
      logGroup,
      memorySize,
      timeout,
      architecture: Architecture.ARM_64,
      runtime: Runtime.NODEJS_22_X,
      environment: {
        LOG_LEVEL: logLevel,
      },
      bundling: {
        format: OutputFormat.ESM,
        mainFields: ["module", "main"],
      },
    });
  }
}