import { poolShapesIncompatible } from "../criticalSpecs";
import {
  parsePoolDimensions,
  poolDepthsMateriallyDifferent,
  poolDiametersMateriallyDifferent,
  poolSpecsSummary,
} from "../poolDimensions";
import type { NormalizedProduct } from "../../types";
import type { PoolsOutdoorGateResult } from "./types";

export type PoolsOutdoorGateInput = {
  source: NormalizedProduct;
  candidate: NormalizedProduct;
  sourceTitle: string;
  candidateTitle: string;
};

function reject(
  reason: string,
  sourceSpec: Record<string, unknown>,
  candidateSpec: Record<string, unknown>
): PoolsOutdoorGateResult {
  return { ok: false, reason, sourceSpec, candidateSpec };
}

/**
 * Pools & outdoor V2 hard gate — both-known-only rejects for diameter, depth, and shape.
 * Missing specs on one side produce soft penalties only (no hard reject).
 */
export function runPoolsOutdoorHardGateV2(
  input: PoolsOutdoorGateInput
): PoolsOutdoorGateResult {
  const { source, candidate, sourceTitle, candidateTitle } = input;
  const src = parsePoolDimensions(sourceTitle, source.structured.title);
  const cand = parsePoolDimensions(candidateTitle, candidate.structured.title);
  const softPenalties: string[] = [];

  const srcShape = src.shape;
  const candShape = cand.shape;
  if (srcShape && candShape && poolShapesIncompatible(srcShape, candShape)) {
    return reject(
      `pool_shape_mismatch(source=${srcShape},candidate=${candShape})`,
      poolSpecsSummary({ ...src, shape: srcShape }),
      poolSpecsSummary({ ...cand, shape: candShape })
    );
  }

  const srcDiam = src.diameterFt;
  const candDiam = cand.diameterFt;
  if (srcDiam != null && candDiam != null) {
    if (poolDiametersMateriallyDifferent(srcDiam, candDiam)) {
      return reject(
        `pool_diameter_mismatch(source=${srcDiam}ft,candidate=${candDiam}ft)`,
        poolSpecsSummary(src),
        poolSpecsSummary(cand)
      );
    }
  } else if (srcDiam != null && candDiam == null) {
    softPenalties.push(
      `pool_v2_diameter_missing_soft(source=${srcDiam}ft,candidate=unknown)`
    );
  } else if (srcDiam == null && candDiam != null) {
    softPenalties.push(
      `pool_v2_diameter_missing_soft(source=unknown,candidate=${candDiam}ft)`
    );
  }

  const srcDepth = src.depthInches;
  const candDepth = cand.depthInches;
  if (srcDepth != null && candDepth != null) {
    if (poolDepthsMateriallyDifferent(srcDepth, candDepth)) {
      return reject(
        `pool_depth_mismatch(source=${srcDepth}in,candidate=${candDepth}in)`,
        poolSpecsSummary(src),
        poolSpecsSummary(cand)
      );
    }
  } else if (srcDepth != null && candDepth == null) {
    softPenalties.push(
      `pool_v2_depth_missing_soft(source=${srcDepth}in,candidate=unknown)`
    );
  } else if (srcDepth == null && candDepth != null) {
    softPenalties.push(
      `pool_v2_depth_missing_soft(source=unknown,candidate=${candDepth}in)`
    );
  }

  return { ok: true, softPenalties };
}
