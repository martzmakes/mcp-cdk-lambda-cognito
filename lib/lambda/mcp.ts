import { Handler } from "aws-lambda";
import { createApiGatewayHandler } from "./handlers/api-gateway-handler";
import { DogFactsServer } from "./servers/dog-facts/server";

// Create the dog facts server instance
const dogFactsServer = new DogFactsServer();

// Create and export the handler
export const handler: Handler = createApiGatewayHandler(dogFactsServer);