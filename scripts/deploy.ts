import { ethers, run, network } from 'hardhat';
import { TransactionResponse } from 'ethers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { HttpNetworkConfig } from 'hardhat/types';
import { encryptDataField } from '@swisstronik/utils';
import fs from 'fs';
import path from 'path';

const sendShieldedTransaction = async (
  signer: HardhatEthersSigner,
  destination: string,
  data: string,
  value: string
) => {
  const rpclink = "https://json-rpc.testnet.swisstronik.com";
  const [encryptedData] = await encryptDataField(rpclink, data);

  return await signer.sendTransaction({
    from: signer.address,
    to: destination,
    data: encryptedData,
    value,
    gasLimit: 2000000,
    chainId: (await ethers.provider.getNetwork()).chainId,
  });
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);

  // Deploy MyContractV1
  const MyContractV1 = await ethers.getContractFactory('MyContractV1');
  const myContractV1 = await MyContractV1.deploy();
  await myContractV1.waitForDeployment();
  console.log(`MyContractV1 deployed to: ${myContractV1.target}`);

  // Deploy ProxyAdmin
  const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin');
  const proxyAdmin = await ProxyAdmin.deploy(deployer.address);
  await proxyAdmin.waitForDeployment();
  console.log(`ProxyAdmin deployed to: ${proxyAdmin.target}`);

  // Deploy TransparentUpgradeableProxy
  const TransparentUpgradeableProxy = await ethers.getContractFactory('TransparentUpgradeableProxy');
  const transparentUpgradeableProxy = await TransparentUpgradeableProxy.deploy(
    myContractV1.target,
    proxyAdmin.target,
    '0x' // No initialization data needed for MyContractV1
  );
  await transparentUpgradeableProxy.waitForDeployment();
  console.log(`TransparentUpgradeableProxy deployed to: ${transparentUpgradeableProxy.target}`);

  // Deploy MyContractV2
  const MyContractV2 = await ethers.getContractFactory('MyContractV2');
  const myContractV2 = await MyContractV2.deploy();
  await myContractV2.waitForDeployment();
  console.log(`MyContractV2 deployed to: ${myContractV2.target}`);

  // Upgrade Proxy
  const ProxyAdminContract = await ethers.getContractAt('ProxyAdmin', proxyAdmin.target);
  console.log('Upgrading Proxy...');
  
  // Prepare data for upgradeAndCall
  const upgradeData = ProxyAdminContract.interface.encodeFunctionData('upgradeAndCall', [
    transparentUpgradeableProxy.target,
    myContractV2.target,
    '0x' // No additional data needed for the upgrade
  ]);

  const tx: TransactionResponse = await sendShieldedTransaction(
    deployer,
    proxyAdmin.target,
    upgradeData,
    '0'
  );

  //console.log(`Upgrade transaction sent: ${tx.hash}`);
  console.log(`Proxy upgraded to MyContractV2 at: ${myContractV2.target}`);

  // Write addresses to files
  const deployedProxyAddressWithExplorer = path.join(__dirname, '../utils/address-with-explorer.txt');
  fs.writeFileSync(
    deployedProxyAddressWithExplorer,
    `ProxyAdmin: https://explorer-evm.testnet.swisstronik.com/address/${proxyAdmin.target}\nTransparentUpgradeableProxy: https://explorer-evm.testnet.swisstronik.com/address/${transparentUpgradeableProxy.target}\n`,
    { flag: 'a' }
  );

  const deployedAddressPath = path.join(__dirname, '..', 'utils', 'deployed-address.ts');
  const fileContent = `export const TransparentUpgradeableProxy = '${transparentUpgradeableProxy.target}'\nexport const MyContractV1 = '${myContractV1.address}'\nexport const MyContractV2 = '${myContractV2.target}'\n`;
  fs.writeFileSync(deployedAddressPath, fileContent, { encoding: 'utf8' });
  console.log('Address written to deployed-address.ts');

  // Verify all contracts
  await verifyContract(myContractV1.target, 'MyContractV1', []);
  await verifyContract(proxyAdmin.target, 'ProxyAdmin', [deployer.address]);
  await verifyContract(transparentUpgradeableProxy.target, 'TransparentUpgradeableProxy', [myContractV1.target, proxyAdmin.target, '0x']);
  await verifyContract(myContractV2.target, 'MyContractV2', []);
}

async function verifyContract(address: string, contractName: string, constructorArguments: any[]) {
  try {
    console.log(`Verifying contract at ${address} ...`);
    await run('verify:verify', {
      address,
      contract: `contracts/${contractName}.sol:${contractName}`,
      constructorArguments,
    });
    console.log(`Contract verified: ${address}`);
  } catch (error) {
    console.error(`Verification failed for ${address}: ${error.message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
