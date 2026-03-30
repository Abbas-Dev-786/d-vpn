import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // ratePerSecond in test tokens
  // 1 token per second for demo purposes
  const ratePerSecond = 1;

  // trustedRelayer is the backend's EOA that will submit the meta-tx/relayed tx
  // For dev purposes, we'll assign it to deployer.
  const trustedRelayer = deployer;

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
