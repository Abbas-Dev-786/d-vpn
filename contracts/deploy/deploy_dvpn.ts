import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { vars } from "hardhat/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // ratePerSecond in test tokens
  // 1 token per second for demo purposes
  const ratePerSecond = 1;

  // trustedRelayer is the backend EOA that submits encrypted-input transactions.
  // Defaults to deployer for local runs.
  const trustedRelayer = vars.get("TRUSTED_RELAYER", deployer);

  const deployedDVPN = await deploy("DVPN", {
    from: deployer,
    args: [ratePerSecond, trustedRelayer],
    log: true,
  });

  console.log(`DVPN contract address: `, deployedDVPN.address);
};

export default func;
func.id = "deploy_dvpn";
func.tags = ["DVPN"];
