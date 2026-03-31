import { getRuntimeConfig } from "../config/runtime";

const runtime = getRuntimeConfig();

type CreateFlowScheduleInput = {
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

const schedulerHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${runtime.flowSchedulerApiKey}`,
});

export const createFlowSchedule = async (
  input: CreateFlowScheduleInput,
): Promise<CreateFlowScheduleResult> => {
  const response = await fetch(`${runtime.flowSchedulerApiUrl}/schedules`, {
    method: "POST",
    headers: schedulerHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create Flow schedule: ${response.status} ${text}`);
  }

  const data = (await response.json()) as Partial<CreateFlowScheduleResult>;
  if (!data.jobId || !data.scheduleTxHash || !data.nextRunAt || !data.status) {
    throw new Error("Scheduler response missing required fields");
  }

  return {
    jobId: data.jobId,
    scheduleTxHash: data.scheduleTxHash,
    nextRunAt: data.nextRunAt,
    cadence: data.cadence ?? input.frequency,
    status: data.status,
  };
};

export const getFlowSchedule = async (jobId: string): Promise<ListFlowScheduleResult> => {
  const response = await fetch(`${runtime.flowSchedulerApiUrl}/schedules/${jobId}`, {
    method: "GET",
    headers: schedulerHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Flow schedule: ${response.status} ${text}`);
  }

  const data = (await response.json()) as Partial<ListFlowScheduleResult>;
  if (!data.jobId || !data.status || !data.nextRunAt) {
    throw new Error("Invalid Flow schedule status response");
  }

  return {
    jobId: data.jobId,
    status: data.status,
    nextRunAt: data.nextRunAt,
    lastRunAt: data.lastRunAt,
    lastRunStatus: data.lastRunStatus,
    lastRunTxHash: data.lastRunTxHash,
    failureReason: data.failureReason,
  };
};

