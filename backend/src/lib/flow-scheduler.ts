import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getRuntimeConfig } from "../config/runtime";
import { logger } from "./logger";

const runtime = getRuntimeConfig();
const execFileAsync = promisify(execFile);

type CreateFlowScheduleInput = {
  scheduleId: string;
  flowUserAddress: string;
  custodialWalletAddress: string;
  treasuryAddress: string;
  budgetAmount: string;
  frequency: "weekly" | "monthly";
  metadata?: Record<string, unknown>;
};

type CreateFlowScheduleResult = {
  jobId: string;
  scheduleTxHash: string;
  nextRunAt: string;
  cadence: string;
  status: "active" | "pending";
};

type ListFlowScheduleResult = {
  jobId: string;
  status: "active" | "paused" | "failed" | "pending";
  nextRunAt: string;
  lastRunAt?: string;
  lastRunStatus?: "success" | "failed";
  lastRunTxHash?: string;
  failureReason?: string;
};

type CadenceArg = {
  type: string;
  value: unknown;
};

const strip0x = (value: string): string =>
  value.startsWith("0x") ? value.slice(2) : value;

const toStorageIdentifier = (scheduleId: string): string => {
  const compact = scheduleId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `dvpncron${compact.slice(0, 48)}`;
};

const toUFix64 = (value: string): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("budgetAmount must be a positive number");
  }
  return numeric.toFixed(8);
};

const findCadenceValueObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.type === "string" && Object.prototype.hasOwnProperty.call(obj, "value")) {
    return obj;
  }
  for (const nested of Object.values(obj)) {
    const found = findCadenceValueObject(nested);
    if (found) return found;
  }
  return null;
};

const decodeCadenceValue = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj.type !== "string" || !Object.prototype.hasOwnProperty.call(obj, "value")) {
    return value;
  }

  const t = obj.type;
  const v = obj.value;
  switch (t) {
    case "String":
      return String(v);
    case "Bool":
      return v === true || v === "true";
    case "Address":
      return `0x${strip0x(String(v))}`;
    case "UInt":
    case "UInt8":
    case "UInt16":
    case "UInt32":
    case "UInt64":
    case "UInt128":
    case "UInt256":
    case "Int":
    case "Int8":
    case "Int16":
    case "Int32":
    case "Int64":
    case "Int128":
    case "Int256":
    case "Fix64":
    case "UFix64":
      return String(v);
    case "Optional":
      return v == null ? null : decodeCadenceValue(v);
    case "Array":
      return Array.isArray(v) ? v.map((entry) => decodeCadenceValue(entry)) : [];
    case "Dictionary":
      if (!Array.isArray(v)) return {};
      return Object.fromEntries(
        v.map((entry) => {
          const pair = entry as { key: unknown; value: unknown };
          return [String(decodeCadenceValue(pair.key)), decodeCadenceValue(pair.value)];
        }),
      );
    case "Struct":
    case "Resource":
    case "Event":
      if (!Array.isArray(v)) return {};
      return Object.fromEntries(
        v.map((field) => {
          const typed = field as { name: string; value: unknown };
          return [typed.name, decodeCadenceValue(typed.value)];
        }),
      );
    default:
      return v;
  }
};

const findTransactionId = (value: unknown): string | null => {
  if (typeof value === "string") {
    const match = value.match(/\b[0-9a-fA-F]{64}\b/);
    return match ? `0x${match[0]}` : null;
  }
  if (!value || typeof value !== "object") return null;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = findTransactionId(nested);
    if (found) return found;
  }
  return null;
};

const cadenceImports = (): string => `
import FlowCron from 0x${strip0x(runtime.flowCronAddress)}
import FlowCronUtils from 0x${strip0x(runtime.flowCronUtilsAddress)}
import FlowTransactionScheduler from 0x${strip0x(runtime.flowTransactionSchedulerAddress)}
import FlowTransactionSchedulerUtils from 0x${strip0x(runtime.flowTransactionSchedulerUtilsAddress)}
import FlowToken from 0x${strip0x(runtime.flowTokenAddress)}
import FungibleToken from 0x${strip0x(runtime.fungibleTokenAddress)}
import EVM from 0x${strip0x(runtime.evmCadenceAddress)}
`;

const createScheduleCadence = (): string => `
${cadenceImports()}

transaction(
  cronExpression: String,
  cronHandlerStoragePath: StoragePath,
  destinationEVMAddress: String,
  transferAmount: UFix64,
  executorPriority: UInt8,
  executorExecutionEffort: UInt64,
  keeperExecutionEffort: UInt64,
  callGasLimit: UInt64
) {
  let manager: auth(FlowTransactionSchedulerUtils.Owner) &{FlowTransactionSchedulerUtils.Manager}
  let executorTime: UInt64
  let keeperTime: UInt64
  let cronHandlerCap: Capability<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>
  let executorContext: FlowCron.CronContext
  let keeperContext: FlowCron.CronContext
  let executorFees: @FlowToken.Vault
  let keeperFees: @FlowToken.Vault

  prepare(account: auth(BorrowValue, SaveValue, IssueStorageCapabilityController, GetStorageCapabilityController, PublishCapability, Capabilities, Storage) &Account) {
    if account.storage.borrow<&FlowToken.Vault>(from: /storage/flowTokenVault) == nil {
      account.storage.save(<-FlowToken.createEmptyVault(vaultType: Type<@FlowToken.Vault>()), to: /storage/flowTokenVault)

      let receiverCap = account.capabilities.storage.issue<&FlowToken.Vault>(/storage/flowTokenVault)
      account.capabilities.publish(receiverCap, at: /public/flowTokenReceiver)

      let balanceCap = account.capabilities.storage.issue<&FlowToken.Vault>(/storage/flowTokenVault)
      account.capabilities.publish(balanceCap, at: /public/flowTokenBalance)
    }

    if account.storage.type(at: /storage/evm) == nil {
      account.storage.save(<-EVM.createCadenceOwnedAccount(), to: /storage/evm)
      let coaCapability = account.capabilities.storage.issue<&EVM.CadenceOwnedAccount>(/storage/evm)
      account.capabilities.publish(coaCapability, at: /public/evm)
    }

    if !account.storage.check<@{FlowTransactionSchedulerUtils.Manager}>(from: FlowTransactionSchedulerUtils.managerStoragePath) {
      let manager <- FlowTransactionSchedulerUtils.createManager()
      account.storage.save(<-manager, to: FlowTransactionSchedulerUtils.managerStoragePath)
    }

    if !account.storage.check<@FlowTransactionSchedulerUtils.COATransactionHandler>(from: FlowTransactionSchedulerUtils.coaHandlerStoragePath()) {
      var coaCapability: Capability<auth(EVM.Owner) &EVM.CadenceOwnedAccount>? = nil
      for controller in account.capabilities.storage.getControllers(forPath: /storage/evm) {
        if let capability = controller.capability as? Capability<auth(EVM.Owner) &EVM.CadenceOwnedAccount> {
          coaCapability = capability
          break
        }
      }
      if coaCapability == nil {
        coaCapability = account.capabilities.storage.issue<auth(EVM.Owner) &EVM.CadenceOwnedAccount>(/storage/evm)
      }

      var flowTokenVaultCapability: Capability<auth(FungibleToken.Withdraw) &FlowToken.Vault>? = nil
      for controller in account.capabilities.storage.getControllers(forPath: /storage/flowTokenVault) {
        if let capability = controller.capability as? Capability<auth(FungibleToken.Withdraw) &FlowToken.Vault> {
          flowTokenVaultCapability = capability
          break
        }
      }
      if flowTokenVaultCapability == nil {
        flowTokenVaultCapability = account.capabilities.storage.issue<auth(FungibleToken.Withdraw) &FlowToken.Vault>(/storage/flowTokenVault)
      }

      let handler <- FlowTransactionSchedulerUtils.createCOATransactionHandler(
        coaCapability: coaCapability!,
        flowTokenVaultCapability: flowTokenVaultCapability!
      )
      account.storage.save(<-handler, to: FlowTransactionSchedulerUtils.coaHandlerStoragePath())
    }

    if account.storage.type(at: cronHandlerStoragePath) != nil {
      panic("Cron handler already exists at requested storage path")
    }

    let wrappedHandlerCap = account.capabilities.storage.issue<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>(
      FlowTransactionSchedulerUtils.coaHandlerStoragePath()
    )

    let feeProviderCap = account.capabilities.storage.issue<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
      /storage/flowTokenVault
    )

    let schedulerManagerCap = account.capabilities.storage.issue<auth(FlowTransactionSchedulerUtils.Owner) &{FlowTransactionSchedulerUtils.Manager}>(
      FlowTransactionSchedulerUtils.managerStoragePath
    )

    let cronHandler <- FlowCron.createCronHandler(
      cronExpression: cronExpression,
      wrappedHandlerCap: wrappedHandlerCap,
      feeProviderCap: feeProviderCap,
      schedulerManagerCap: schedulerManagerCap
    )
    account.storage.save(<-cronHandler, to: cronHandlerStoragePath)

    self.manager = account.storage.borrow<auth(FlowTransactionSchedulerUtils.Owner) &{FlowTransactionSchedulerUtils.Manager}>(
      from: FlowTransactionSchedulerUtils.managerStoragePath
    ) ?? panic("Could not borrow scheduler manager")

    let cronHandlerRef = account.storage.borrow<&FlowCron.CronHandler>(from: cronHandlerStoragePath)
      ?? panic("CronHandler was not found after creation")

    let cronSpec = cronHandlerRef.getCronSpec()
    let currentTime = UInt64(getCurrentBlock().timestamp)
    self.executorTime = FlowCronUtils.nextTick(spec: cronSpec, afterUnix: currentTime)
      ?? panic("Unable to compute next cron tick")
    self.keeperTime = self.executorTime + FlowCron.keeperOffset

    self.cronHandlerCap = account.capabilities.storage.issue<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>(
      cronHandlerStoragePath
    )

    let transferBalance = EVM.Balance(attoflow: 0)
    transferBalance.setFLOW(flow: transferAmount)
    let transferParams = FlowTransactionSchedulerUtils.COAHandlerParams(
      txType: FlowTransactionSchedulerUtils.COAHandlerTxType.Call.rawValue,
      revertOnFailure: true,
      amount: nil,
      callToEVMAddress: destinationEVMAddress,
      data: nil,
      gasLimit: callGasLimit,
      value: transferBalance.attoflow
    )

    let priorityEnum = FlowTransactionScheduler.Priority(rawValue: executorPriority)
      ?? panic("Invalid priority")

    self.executorContext = FlowCron.CronContext(
      executionMode: FlowCron.ExecutionMode.Executor,
      executorPriority: priorityEnum,
      executorExecutionEffort: executorExecutionEffort,
      keeperExecutionEffort: keeperExecutionEffort,
      wrappedData: transferParams
    )

    self.keeperContext = FlowCron.CronContext(
      executionMode: FlowCron.ExecutionMode.Keeper,
      executorPriority: priorityEnum,
      executorExecutionEffort: executorExecutionEffort,
      keeperExecutionEffort: keeperExecutionEffort,
      wrappedData: transferParams
    )

    let executorEstimate = FlowTransactionScheduler.estimate(
      data: self.executorContext,
      timestamp: UFix64(self.executorTime),
      priority: priorityEnum,
      executionEffort: executorExecutionEffort
    )
    let executorFee = executorEstimate.flowFee
      ?? panic("Unable to estimate executor fee")

    let keeperEstimate = FlowTransactionScheduler.estimate(
      data: self.keeperContext,
      timestamp: UFix64(self.keeperTime),
      priority: FlowCron.keeperPriority,
      executionEffort: keeperExecutionEffort
    )
    let keeperFee = keeperEstimate.flowFee
      ?? panic("Unable to estimate keeper fee")

    let totalFee = executorFee + keeperFee
    let feeVault = account.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
      ?? panic("Could not borrow FlowToken vault")

    if feeVault.balance < totalFee {
      panic("Insufficient FLOW balance to prepay cron schedule fees")
    }

    self.executorFees <- feeVault.withdraw(amount: executorFee) as! @FlowToken.Vault
    self.keeperFees <- feeVault.withdraw(amount: keeperFee) as! @FlowToken.Vault
  }

  execute {
    self.manager.schedule(
      handlerCap: self.cronHandlerCap,
      data: self.executorContext,
      timestamp: UFix64(self.executorTime),
      priority: self.executorContext.executorPriority,
      executionEffort: self.executorContext.executorExecutionEffort,
      fees: <-self.executorFees
    )

    self.manager.schedule(
      handlerCap: self.cronHandlerCap,
      data: self.keeperContext,
      timestamp: UFix64(self.keeperTime),
      priority: FlowCron.keeperPriority,
      executionEffort: self.keeperContext.keeperExecutionEffort,
      fees: <-self.keeperFees
    )
  }
}
`;

const statusScriptCadence = (): string => `
import FlowCron from 0x${strip0x(runtime.flowCronAddress)}
import FlowTransactionScheduler from 0x${strip0x(runtime.flowTransactionSchedulerAddress)}

access(all) fun main(address: Address, storagePath: StoragePath): String {
  let account = getAuthAccount<auth(BorrowValue) &Account>(address)
  let handler = account.storage.borrow<&FlowCron.CronHandler>(from: storagePath)
  if handler == nil {
    return "missing"
  }

  let executorID = handler!.getNextScheduledExecutorID()
  let keeperID = handler!.getNextScheduledKeeperID()

  var executorStatus: UInt8 = 0
  var keeperStatus: UInt8 = 0
  var executorTimestamp: UFix64 = 0.0
  var keeperTimestamp: UFix64 = 0.0

  if let id = executorID {
    if let txData = FlowTransactionScheduler.getTransactionData(id: id) {
      executorStatus = txData.status.rawValue
      executorTimestamp = txData.scheduledTimestamp
    }
  }

  if let id = keeperID {
    if let txData = FlowTransactionScheduler.getTransactionData(id: id) {
      keeperStatus = txData.status.rawValue
      keeperTimestamp = txData.scheduledTimestamp
    }
  }

  return "\\(executorStatus)|\\(executorTimestamp)|\\(keeperStatus)|\\(keeperTimestamp)"
}
`;

const runFlowCli = async (
  mode: "transaction" | "script",
  cadenceCode: string,
  argsJson: CadenceArg[],
): Promise<string> => {
  const tmpPrefix = join(tmpdir(), "flow-native-scheduler-");
  const workdir = await mkdtemp(tmpPrefix);
  const configPath = join(workdir, "flow.json");
  const cadencePath = join(workdir, mode === "transaction" ? "tx.cdc" : "script.cdc");

  const flowConfig = {
    networks: {
      [runtime.flowCadenceNetwork]: runtime.flowCadenceAccessNode,
    },
    accounts: {
      scheduler: {
        address: strip0x(runtime.flowSchedulerAddress),
        key: {
          type: "hex",
          index: runtime.flowSchedulerKeyIndex,
          privateKey: strip0x(runtime.flowSchedulerPrivateKey),
        },
      },
    },
  };

  try {
    await writeFile(configPath, JSON.stringify(flowConfig, null, 2), "utf8");
    await writeFile(cadencePath, cadenceCode, "utf8");

    const commonArgs = [
      "--config-path",
      configPath,
      "--network",
      runtime.flowCadenceNetwork,
      "--args-json",
      JSON.stringify(argsJson),
      "--output",
      "json",
      "--log",
      "none",
    ];

    const cliArgs =
      mode === "transaction"
        ? ["transactions", "send", cadencePath, "--signer", "scheduler", ...commonArgs, "--yes"]
        : ["scripts", "execute", cadencePath, ...commonArgs];

    const { stdout, stderr } = await execFileAsync("flow", cliArgs, {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (stderr?.trim()) {
      logger.debug({ stderr }, "Flow CLI stderr output");
    }
    return stdout;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
};

const runFlowTransaction = async (cadenceCode: string, argsJson: CadenceArg[]): Promise<string> => {
  const stdout = await runFlowCli("transaction", cadenceCode, argsJson);
  const parsed = (() => {
    try {
      return JSON.parse(stdout) as unknown;
    } catch {
      return stdout as unknown;
    }
  })();
  const txHash = findTransactionId(parsed) ?? findTransactionId(stdout);
  if (!txHash) {
    throw new Error(`Could not parse Flow transaction ID from output: ${stdout}`);
  }
  return txHash;
};

const runFlowScript = async (cadenceCode: string, argsJson: CadenceArg[]): Promise<unknown> => {
  const stdout = await runFlowCli("script", cadenceCode, argsJson);
  const parsed = JSON.parse(stdout) as unknown;
  const cadenceObj = findCadenceValueObject(parsed);
  if (cadenceObj) {
    return decodeCadenceValue(cadenceObj);
  }
  return parsed;
};

const frequencyToCronExpression = (frequency: "weekly" | "monthly"): string =>
  frequency === "weekly" ? "0 0 * * 1" : "0 0 1 * *";

const parseStatusPayload = (
  payload: unknown,
): { status: ListFlowScheduleResult["status"]; nextRunAt: string; failureReason?: string } => {
  if (typeof payload !== "string") {
    return {
      status: "failed",
      nextRunAt: new Date().toISOString(),
      failureReason: "Unexpected Flow scheduler response payload",
    };
  }

  if (payload === "missing") {
    return {
      status: "failed",
      nextRunAt: new Date().toISOString(),
      failureReason: "Flow cron handler not found at storage path",
    };
  }

  const parts = payload.split("|");
  if (parts.length !== 4) {
    return {
      status: "failed",
      nextRunAt: new Date().toISOString(),
      failureReason: "Invalid Flow cron status format",
    };
  }

  const [executorStatusRaw, executorTsRaw, keeperStatusRaw, keeperTsRaw] = parts;
  const executorStatus = Number(executorStatusRaw);
  const keeperStatus = Number(keeperStatusRaw);

  const timestamps = [executorTsRaw, keeperTsRaw]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  const nextRunAt = timestamps.length > 0 ? new Date(timestamps[0] * 1000).toISOString() : new Date().toISOString();
  if (executorStatus === 3 && keeperStatus === 3) {
    return { status: "paused", nextRunAt };
  }
  if (executorStatus === 1 || keeperStatus === 1) {
    return { status: "active", nextRunAt };
  }
  if (executorStatus === 2 || keeperStatus === 2) {
    return { status: "pending", nextRunAt };
  }
  return {
    status: "failed",
    nextRunAt,
    failureReason: "Scheduled transactions are not currently active onchain",
  };
};

export const createFlowSchedule = async (
  input: CreateFlowScheduleInput,
): Promise<CreateFlowScheduleResult> => {
  const storageIdentifier = toStorageIdentifier(input.scheduleId);
  const cronExpression = frequencyToCronExpression(input.frequency);
  const scheduleCadence = createScheduleCadence();
  const transferAmount = toUFix64(input.budgetAmount);
  const executorPriority = (process.env.FLOW_CRON_EXECUTOR_PRIORITY ?? "1").trim();
  const executorEffort = (process.env.FLOW_CRON_EXECUTOR_EFFORT ?? "1000").trim();
  const keeperEffort = (process.env.FLOW_CRON_KEEPER_EFFORT ?? "2500").trim();
  const callGasLimit = (process.env.FLOW_CRON_CALL_GAS_LIMIT ?? "100000").trim();

  const txHash = await runFlowTransaction(scheduleCadence, [
    { type: "String", value: cronExpression },
    { type: "Path", value: { domain: "storage", identifier: storageIdentifier } },
    { type: "String", value: input.treasuryAddress },
    { type: "UFix64", value: transferAmount },
    { type: "UInt8", value: executorPriority },
    { type: "UInt64", value: executorEffort },
    { type: "UInt64", value: keeperEffort },
    { type: "UInt64", value: callGasLimit },
  ]);

  const current = await getFlowSchedule(storageIdentifier);
  return {
    jobId: storageIdentifier,
    scheduleTxHash: txHash,
    nextRunAt: current.nextRunAt,
    cadence: input.frequency,
    status: current.status === "active" ? "active" : "pending",
  };
};

export const getFlowSchedule = async (jobId: string): Promise<ListFlowScheduleResult> => {
  const payload = await runFlowScript(statusScriptCadence(), [
    { type: "Address", value: runtime.flowSchedulerAddress },
    { type: "Path", value: { domain: "storage", identifier: jobId } },
  ]);

  const parsed = parseStatusPayload(payload);
  return {
    jobId,
    status: parsed.status,
    nextRunAt: parsed.nextRunAt,
    lastRunAt: undefined,
    lastRunStatus: undefined,
    lastRunTxHash: undefined,
    failureReason: parsed.failureReason,
  };
};

export const resolveFlowNextRunAt = async (jobId: string): Promise<string> => {
  const result = await getFlowSchedule(jobId);
  return result.nextRunAt;
};
