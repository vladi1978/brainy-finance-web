export type DeptHardRejectLogPayload = {
  department: string;
  reason: string;
  sourceSpec: Record<string, unknown>;
  candidateSpec: Record<string, unknown>;
};

export type PoolsOutdoorGatePass = {
  ok: true;
  softPenalties: string[];
};

export type PoolsOutdoorGateReject = {
  ok: false;
  reason: string;
  sourceSpec: Record<string, unknown>;
  candidateSpec: Record<string, unknown>;
};

export type PoolsOutdoorGateResult = PoolsOutdoorGatePass | PoolsOutdoorGateReject;
