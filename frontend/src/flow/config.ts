import { config } from "@onflow/fcl";

config({
  "app.detail.title": "Confidential-X4PN dVPN",
  "app.detail.icon": "https://cryptologos.cc/logos/flow-flow-logo.png", // Flow logo
  "flow.network": "testnet",
  "accessNode.api": "https://rest-testnet.onflow.org",
  "discovery.wallet": "https://fcl-discovery.onflow.org/testnet/authn",
  "discovery.authn.endpoint": "https://fcl-discovery.onflow.org/api/testnet/authn",
});
