import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { DVPN, DVPN__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  provider: HardhatEthersSigner;
};

async function deployFixture() {
  const ratePerSecond = 5; // e.g. 5 tokens per second
  const factory = (await ethers.getContractFactory("DVPN")) as DVPN__factory;
  const trustedRelayer = await (await ethers.getSigners())[0].getAddress();
  const dvpnContract = (await factory.deploy(ratePerSecond, trustedRelayer)) as DVPN;
  const dvpnContractAddress = await dvpnContract.getAddress();

  return { dvpnContract, dvpnContractAddress, ratePerSecond };
}

describe("DVPN Smart Contract", function () {
  let signers: Signers;
  let dvpnContract: DVPN;
  let dvpnContractAddress: string;
  let ratePerSecond: number;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], provider: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite requires a mock FHEVM environment`);
      this.skip();
    }

    ({ dvpnContract, dvpnContractAddress, ratePerSecond } = await deployFixture());
  });

  it("should successfully log a session and compute homomorphic earnings for provider", async function () {
    // 1. Session start
    const clearStartTime = 1000;
    const encryptedStartTime = await fhevm
      .createEncryptedInput(dvpnContractAddress, signers.alice.address)
      .add64(clearStartTime)
      .encrypt();

    const startTx = await dvpnContract
      .connect(signers.alice)
      .startSession(signers.alice.address, signers.provider.address, encryptedStartTime.handles[0], encryptedStartTime.inputProof);
    await startTx.wait();

    // 2. Session end
    const clearEndTime = 1100; // Duration = 100 seconds
    const encryptedEndTime = await fhevm
      .createEncryptedInput(dvpnContractAddress, signers.alice.address) // or provider if they end it
      .add64(clearEndTime)
      .encrypt();

    const endTx = await dvpnContract
      .connect(signers.alice) // User cleanly terminates it
      .endConfidentialSession(signers.alice.address, encryptedEndTime.handles[0], encryptedEndTime.inputProof);
    await endTx.wait();

    // 3. Provider fetches and decrypts balance
    // The provider's balance should be (1100 - 1000) * ratePerSecond = 100 * 5 = 500
    const encryptedBalance = await dvpnContract.providerBalances(signers.provider.address);
    
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      dvpnContractAddress,
      signers.provider, // Notice provider doing the decrypt requests, they have access because of FHE.allow
    );

    expect(Number(clearBalance)).to.eq(500);
  });

  it("should prevent unauthorized addresses from decrypting the provider balance", async function () {
    const clearStartTime = 500;
    const encryptedStartTime = await fhevm
      .createEncryptedInput(dvpnContractAddress, signers.alice.address)
      .add64(clearStartTime)
      .encrypt();

    await (
      await dvpnContract
        .connect(signers.alice)
        .startSession(signers.alice.address, signers.provider.address, encryptedStartTime.handles[0], encryptedStartTime.inputProof)
    ).wait();

    const clearEndTime = 600;
    const encryptedEndTime = await fhevm
      .createEncryptedInput(dvpnContractAddress, signers.provider.address) // Provider terminates it
      .add64(clearEndTime)
      .encrypt();

    // Dual termination logic test: provider ends it
    await (await dvpnContract.connect(signers.provider).endConfidentialSession(signers.alice.address, encryptedEndTime.handles[0], encryptedEndTime.inputProof)).wait();

    const encryptedBalance = await dvpnContract.providerBalances(signers.provider.address);

    // Try decrypting as alice (who shouldn't have access to the provider balance total)
    let decryptionError = false;
    try {
        await fhevm.userDecryptEuint(
            FhevmType.euint64,
            encryptedBalance,
            dvpnContractAddress,
            signers.alice,
        );
    } catch (e) {
        decryptionError = true;
    }

    expect(decryptionError).to.be.true; // Alice should be denied
  });

  it("should reject relayer submission when ciphertext importer is not the relayer", async function () {
    const encryptedStartTime = await fhevm
      .createEncryptedInput(dvpnContractAddress, signers.alice.address)
      .add64(1234)
      .encrypt();

    await expect(
      dvpnContract
        .connect(signers.deployer)
        .startSession(signers.alice.address, signers.provider.address, encryptedStartTime.handles[0], encryptedStartTime.inputProof),
    ).to.be.reverted;
  });
});
