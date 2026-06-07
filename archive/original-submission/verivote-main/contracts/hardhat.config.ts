import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatTypechain from "@nomicfoundation/hardhat-typechain";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [
    hardhatEthers,
    hardhatTypechain,
    hardhatMocha,
    hardhatEthersChaiMatchers,
    hardhatNetworkHelpers
  ],
  paths: {
    sources: ".",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1"
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545"
    }
  }
});
