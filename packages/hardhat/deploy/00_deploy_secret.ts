import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { MockToken, IERC20 } from "../typechain-types";

/**
 * Deploys a contract named "Secret" using the deployer account and
 * constructor arguments set to the deployer address
 *
 * @param hre HardhatRuntimeEnvironment object.
 */
const deployTokens: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  /*
    On localhost, the deployer account is the one that comes with Hardhat, which is already funded.

    When deploying to live networks (e.g `yarn deploy --network sepolia`), the deployer account
    should have sufficient balance to pay for the gas fees for contract creation.

    You can generate a random account with `yarn generate` or `yarn account:import` to import your
    existing PK which will fill DEPLOYER_PRIVATE_KEY_ENCRYPTED in the .env file (then used on hardhat.config.ts)
    You can run the `yarn account` command to check your balance in every network.
  */
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  let moxieAddress, degenAddress;

  if (hre.network.name === "base") {
    // Use existing contracts on Base network
    moxieAddress = "0x8C9037D1Ef5c6D1f6816278C7AAF5491d24CD527";
    degenAddress = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
  } else {
    // Deploy mock contracts on other networks
    const moxie = await deploy("MOXIE", {
      contract: "MockToken", 
      from: deployer,
      args: ["Moxie Token", "MOXIE"],
      log: true,
    });
    const degen = await deploy("DEGEN", {
      contract: "MockToken",
      from: deployer,
      args: ["Degen Token", "DEGEN"],
      log: true,
    });
    moxieAddress = moxie.address;
    degenAddress = degen.address;
  }

  // Deploy Secret contract
  const secret = await deploy("Secret", {
    from: deployer,
    args: [deployer, moxieAddress, degenAddress],
    log: true,
  });

  // Transfer ownership of Secret contract to specified address

  console.log("Deployed addresses:");
  console.log("MOXIE:", moxieAddress);
  console.log("DEGEN:", degenAddress);
  console.log("Secret:", secret.address);
};

export default deployTokens;

// Tags are useful if you have multiple deploy files and only want to run one of them.
// e.g. yarn deploy --tags Secret
deployTokens.tags = ["MOXIE", "DEGEN", "Secret"];
