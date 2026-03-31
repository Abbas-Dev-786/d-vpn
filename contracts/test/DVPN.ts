import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, network, fhevm } from "hardhat";
import { expect } from "chai";
import { DVPN, DVPN__factory } from "../types";

type Signers = {
  alice: HardhatEthersSigner;
  provider: HardhatEthersSigner;
};

describe("DVPN Sepolia Integration", function () {
  let signers: Signers;
  let dvpnContract: DVPN;
  let dvpnContractAddress: string;
  let relayerSigner: HardhatEthersSigner;

  before(async function () {
    if (network.name !== "sepolia") {
      this.skip();
    }
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { alice: ethSigners[1], provider: ethSigners[2] };

    const contractAddress = process.env.DVPN_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("DVPN_CONTRACT_ADDRESS is required for integration tests");
    }

    dvpnContractAddress = contractAddress;
    dvpnContract = DVPN__factory.connect(dvpnContractAddress, ethSigners[0]);

    const configuredRelayer = await dvpnContract.trustedRelayer();
    const trustedSigner = ethSigners.find(
      (s) => s.address.toLowerCase() === configuredRelayer.toLowerCase(),
    );
    if (!trustedSigner) {
      throw new Error("Trusted relayer address is not available in configured sepolia signers");
    }
    relayerSigner = trustedSigner;
    dvpnContract = DVPN__factory.connect(dvpnContractAddress, relayerSigner);
  });

  it("starts and ends a real confidential session via the trusted relayer", async function () {
    const clearStartTime = BigInt(Date.now());
    const startInput = await fhevm
      .createEncryptedInput(dvpnContractAddress, relayerSigner.address)
      .add64(clearStartTime)
      .encrypt();

    const startTx = await dvpnContract.startSession(
      signers.alice.address,
      signers.provider.address,
      startInput.handles[0],
      startInput.inputProof,
    );
    await startTx.wait();
    expect(startTx.hash).to.match(/^0x[0-9a-fA-F]{64}$/);

    const endInput = await fhevm
      .createEncryptedInput(dvpnContractAddress, relayerSigner.address)
      .add64(clearStartTime + 120n)
      .encrypt();

    const endTx = await dvpnContract.endConfidentialSession(
      signers.alice.address,
      endInput.handles[0],
      endInput.inputProof,
    );
    await endTx.wait();
    expect(endTx.hash).to.match(/^0x[0-9a-fA-F]{64}$/);

    const encryptedBalance = await dvpnContract.providerBalances(signers.provider.address);
    expect(encryptedBalance).to.not.equal(ethers.ZeroHash);
  });

  it("rejects startSession when ciphertext importer does not match tx sender", async function () {
    const wrongImporter = signers.alice.address;
    const encryptedStartTime = await fhevm
      .createEncryptedInput(dvpnContractAddress, wrongImporter)
      .add64(1234n)
      .encrypt();

    await expect(
      dvpnContract
        .connect(relayerSigner)
        .startSession(
          signers.alice.address,
          signers.provider.address,
          encryptedStartTime.handles[0],
          encryptedStartTime.inputProof,
        ),
    ).to.be.reverted;
  });
});
