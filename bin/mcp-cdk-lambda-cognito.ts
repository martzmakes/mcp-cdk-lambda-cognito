#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { McpCdkLambdaCognitoStack } from "../lib/mcp-cdk-lambda-cognito-stack";

const app = new cdk.App();
new McpCdkLambdaCognitoStack(app, "McpCdkLambdaCognitoStack", {
  env: {
    account: process.env["CDK_DEFAULT_ACCOUNT"],
    region: "us-east-1",
  },
  stackName: "StandaloneMcp-DogFacts",
});
