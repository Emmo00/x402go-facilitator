import { describe, expect, it } from "vitest";
import { celo, celoSepolia } from "viem/chains";
import { createConnectedClient, createSigner, getChainFromNetwork } from "./wallet";

describe("wallet configuration", () => {
  it("supports Celo mainnet", () => {
    expect(getChainFromNetwork("celo")).toEqual(celo);
    expect(createConnectedClient("celo").chain).toEqual(celo);
  });

  it("supports Celo Sepolia", () => {
    expect(getChainFromNetwork("celo-sepolia")).toEqual(celoSepolia);
    expect(createConnectedClient("celo-sepolia").chain).toEqual(celoSepolia);
  });

  it("accepts CAIP-2 network names", () => {
    expect(getChainFromNetwork("eip155:42220")).toEqual(celo);
    expect(getChainFromNetwork("eip155:11142220")).toEqual(celoSepolia);
  });

  it("rejects missing and unsupported networks", () => {
    expect(() => getChainFromNetwork("")).toThrow("NETWORK environment variable is not set");
    expect(() => getChainFromNetwork("base")).toThrow("Unsupported network: base");
  });

  it("creates a signer for Celo", () => {
    const signer = createSigner("celo", `0x${"11".repeat(32)}`);

    expect(signer.chain).toEqual(celo);
    expect(signer.account).toBeDefined();
  });
});
