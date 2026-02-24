import { Account, CallData, Contract, RpcProvider, ec, hash, legacyDeployer } from "starknet";
import type { CheckResult, DeploymentArtifacts } from "../config/run-config.js";
import { loadPerpetualArtifact } from "./artifact-loader.js";

const DEVNET_ACCOUNT_1 = {
  address:
    "0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d",
  privateKey:
    "0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07",
};

const DEVNET_ACCOUNT_2 = {
  address:
    "0x008a1719e7ca19f3d91e8ef50a48fc456575f645497a1d55f30e3781f786afe4",
  privateKey:
    "0x0514977443078cf1e0c36bc88b89ada9a46061a5cf728f40274caea21d76f174",
};

const DEVNET_ACCOUNT_3 = {
  address:
    "0x0733a8e2bcced14dcc2608462bd96524fb64eef061689b6d976708efc2c8ddfd",
  privateKey:
    "0x00177100ae65c71074126963e695e17adf5b360146f960378b5cdfd9ed69870b",
};

const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const COMPONENTS = [
  { contract: "perpetuals_VaultsManager", kind: "VAULTS" },
  { contract: "perpetuals_WithdrawalManager", kind: "WITHDRAWALS" },
  { contract: "perpetuals_TransferManager", kind: "TRANSFERS" },
  { contract: "perpetuals_LiquidationManager", kind: "LIQUIDATIONS" },
  { contract: "perpetuals_DeleverageManager", kind: "DELEVERAGES" },
  { contract: "perpetuals_DepositManager", kind: "DEPOSITS" },
  { contract: "perpetuals_AssetsManager", kind: "ASSETS" },
] as const;

export interface DeployerContext {
  provider: RpcProvider;
  governanceAccount: Account;
  userA: Account;
  userB: Account;
  userAPublicKey: string;
  userBPublicKey: string;
  coreContract: Contract;
  coreAbi: unknown[];
  artifacts: DeploymentArtifacts;
}

function normalizeHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function toFeltAscii(value: string): string {
  const hex = Buffer.from(value, "ascii").toString("hex");
  return normalizeHex(`0x${hex}`);
}

async function getNonceOrZero(account: Account): Promise<string> {
  try {
    return await account.getNonce("latest");
  } catch {
    return "0x0";
  }
}

async function waitForAccepted(account: Account, txHash: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    try {
      const receipt = await account.getTransactionReceipt(txHash);
      const finality = (receipt as any)?.finality_status ?? (receipt as any)?.status;
      const execution = (receipt as any)?.execution_status;

      if (finality === "REJECTED" || execution === "REVERTED") {
        throw new Error(`Transaction ${txHash} failed: ${JSON.stringify(receipt)}`);
      }

      if (
        finality === "ACCEPTED_ON_L2" ||
        finality === "ACCEPTED_ON_L1" ||
        finality === "ACCEPTED_ONCHAIN"
      ) {
        return;
      }
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (
        !message.includes("Transaction hash not found") &&
        !message.includes("TRANSACTION_HASH_NOT_FOUND")
      ) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timeout while waiting for tx ${txHash}`);
}

async function declareContract(
  account: Account,
  contract: string,
  releaseDir: string,
): Promise<{ classHash: string; txHash: string | null; abi: unknown[] }> {
  const artifact = await loadPerpetualArtifact(releaseDir, contract);
  const expectedClassHash = hash.computeContractClassHash(artifact.sierra as any);

  try {
    const nonce = await getNonceOrZero(account);
    const response = await account.declare(
      {
        contract: artifact.sierra as any,
        casm: artifact.casm as any,
      },
      { nonce },
    );
    await waitForAccepted(account, response.transaction_hash);

    return {
      classHash: response.class_hash,
      txHash: response.transaction_hash,
      abi: (artifact.sierra as any).abi as unknown[],
    };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (message.includes("already declared") || message.includes("CLASS_ALREADY_DECLARED")) {
      return {
        classHash: expectedClassHash,
        txHash: null,
        abi: (artifact.sierra as any).abi as unknown[],
      };
    }
    throw error;
  }
}

async function executeCall(
  account: Account,
  contractAddress: string,
  entrypoint: string,
  calldata: any[] | Record<string, unknown>,
): Promise<string> {
  const nonce = await getNonceOrZero(account);
  const response = await account.execute(
    {
      contractAddress,
      entrypoint,
      calldata: Array.isArray(calldata) ? calldata : CallData.compile(calldata as any),
    },
    { nonce },
  );

  await waitForAccepted(account, response.transaction_hash);
  return response.transaction_hash;
}

export async function deployPerpetualV1(options: {
  rpcUrl: string;
  perpetualReleaseDir: string;
  checks: CheckResult[];
}): Promise<DeployerContext> {
  const provider = new RpcProvider({ nodeUrl: options.rpcUrl });

  const governanceAccount = new Account({
    provider,
    address: DEVNET_ACCOUNT_1.address,
    signer: DEVNET_ACCOUNT_1.privateKey,
    deployer: legacyDeployer,
  });

  const userA = new Account({
    provider,
    address: DEVNET_ACCOUNT_2.address,
    signer: DEVNET_ACCOUNT_2.privateKey,
    deployer: legacyDeployer,
  });

  const userB = new Account({
    provider,
    address: DEVNET_ACCOUNT_3.address,
    signer: DEVNET_ACCOUNT_3.privateKey,
    deployer: legacyDeployer,
  });

  const userAPublicKey = ec.starkCurve.getStarkKey(DEVNET_ACCOUNT_2.privateKey);
  const userBPublicKey = ec.starkCurve.getStarkKey(DEVNET_ACCOUNT_3.privateKey);

  const coreDecl = await declareContract(governanceAccount, "perpetuals_Core", options.perpetualReleaseDir);
  options.checks.push({
    id: "deploy_smoke.core_declare",
    status: "pass",
    details: "Declared perpetuals_Core",
    evidence: { classHash: coreDecl.classHash, txHash: coreDecl.txHash },
  });

  const componentClassHashes: Record<string, string> = {};
  for (const component of COMPONENTS) {
    const decl = await declareContract(governanceAccount, component.contract, options.perpetualReleaseDir);
    componentClassHashes[component.kind] = decl.classHash;
  }
  options.checks.push({
    id: "deploy_smoke.components_declare",
    status: "pass",
    details: "Declared external component contracts",
    evidence: componentClassHashes,
  });

  const governancePublicKey = ec.starkCurve.getStarkKey(DEVNET_ACCOUNT_1.privateKey);

  const constructorCalldata = CallData.compile({
    governance_admin: governanceAccount.address,
    upgrade_delay: 0,
    collateral_id: { value: hash.getSelectorFromName("COLLATERAL_ASSET_ID") },
    collateral_token_address: STRK_TOKEN_ADDRESS,
    collateral_quantum: 1,
    max_price_interval: { seconds: 86_400 },
    max_oracle_price_validity: { seconds: 600 },
    max_funding_interval: { seconds: 86_400 },
    max_funding_rate: 35_792,
    cancel_delay: { seconds: 604_800 },
    fee_position_owner_public_key: governancePublicKey,
    insurance_fund_position_owner_public_key: governancePublicKey,
    forced_action_timelock: 604_800,
    premium_cost: 100,
    max_interest_rate_per_sec: 1_200,
  });

  const deployNonce = await getNonceOrZero(governanceAccount);
  const deployResponse = await governanceAccount.deploy(
    {
      classHash: coreDecl.classHash,
      constructorCalldata,
    },
    { nonce: deployNonce },
  );

  await waitForAccepted(governanceAccount, deployResponse.transaction_hash);
  const coreAddress = Array.isArray(deployResponse.contract_address)
    ? deployResponse.contract_address[0]
    : deployResponse.contract_address;

  options.checks.push({
    id: "deploy_smoke.core_deploy",
    status: "pass",
    details: "Deployed perpetual core contract",
    evidence: { coreAddress, txHash: deployResponse.transaction_hash },
  });

  await executeCall(
    governanceAccount,
    coreAddress,
    "register_app_role_admin",
    [governanceAccount.address],
  );
  await executeCall(
    governanceAccount,
    coreAddress,
    "register_app_governor",
    [governanceAccount.address],
  );
  await executeCall(
    governanceAccount,
    coreAddress,
    "register_operator",
    [governanceAccount.address],
  );
  await executeCall(
    governanceAccount,
    coreAddress,
    "register_token_admin",
    [governanceAccount.address],
  );
  await executeCall(
    governanceAccount,
    coreAddress,
    "register_upgrade_governor",
    [governanceAccount.address],
  );
  await executeCall(
    governanceAccount,
    coreAddress,
    "register_security_admin",
    [governanceAccount.address],
  );
  await executeCall(
    governanceAccount,
    coreAddress,
    "register_security_agent",
    [governanceAccount.address],
  );

  options.checks.push({
    id: "deploy_smoke.roles_registered",
    status: "pass",
    details: "Registered governance/app/operator/security roles",
  });

  for (const component of COMPONENTS) {
    await executeCall(governanceAccount, coreAddress, "register_external_component", [
      toFeltAscii(component.kind),
      componentClassHashes[component.kind],
    ]);
    await executeCall(governanceAccount, coreAddress, "activate_external_component", [
      toFeltAscii(component.kind),
      componentClassHashes[component.kind],
    ]);
  }

  options.checks.push({
    id: "component_activation_smoke",
    status: "pass",
    details: "Registered and activated all external components",
  });

  const coreContract = new Contract({
    abi: coreDecl.abi,
    address: coreAddress,
    providerOrAccount: governanceAccount,
  });

  return {
    provider,
    governanceAccount,
    userA,
    userB,
    userAPublicKey,
    userBPublicKey,
    coreContract,
    coreAbi: coreDecl.abi,
    artifacts: {
      coreClassHash: coreDecl.classHash,
      coreAddress,
      components: componentClassHashes,
    },
  };
}
