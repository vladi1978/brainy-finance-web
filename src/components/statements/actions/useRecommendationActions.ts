"use client";

import { useCallback, useMemo, useState } from "react";

import {
  computeAcceptedSavings,
  clearRecommendationStates,
  enrichRecommendations,
  getActionDefinition,
  loadRecommendationStates,
  logFinancialAction,
  saveRecommendationState,
  type ActionModalKind,
  type EnrichedRecommendation,
  type RecommendationInput,
  type StoredRecommendationState,
} from "@/lib/statements/actions";

export function useRecommendationActions(items: RecommendationInput[]) {
  const [states, setStates] = useState<
    Record<string, StoredRecommendationState>
  >(() => loadRecommendationStates());
  const [modalRecId, setModalRecId] = useState<string | null>(null);
  const [modalKind, setModalKind] = useState<ActionModalKind>("provider_compare");

  const enriched = useMemo(
    () => enrichRecommendations(items, states),
    [items, states]
  );

  const visible = enriched;

  const acceptedSummary = useMemo(
    () => computeAcceptedSavings(enriched),
    [enriched]
  );

  const modalRec = useMemo(
    () => enriched.find((r) => r.id === modalRecId) ?? null,
    [enriched, modalRecId]
  );

  const applyStatus = useCallback(
    (rec: EnrichedRecommendation, actionId: string, status: EnrichedRecommendation["status"]) => {
      const stored = saveRecommendationState(rec.id, {
        status,
        lastActionId: actionId,
      });
      setStates((prev) => ({ ...prev, [rec.id]: stored }));
      logFinancialAction({
        recommendationId: rec.id,
        actionType: rec.actionType,
        actionId,
        status,
        merchant: rec.merchant,
        estimatedMonthlySavings: rec.estimatedMonthlySavings,
        severity: rec.severity,
        confidence: rec.confidence,
      });
    },
    []
  );

  const dispatchAction = useCallback(
    (recId: string, actionId: string) => {
      const rec = enriched.find((r) => r.id === recId);
      if (!rec) return;

      const def = getActionDefinition(rec.actionType, actionId);
      if (!def) return;

      if (def.opensModal) {
        setModalKind(def.opensModal);
        setModalRecId(recId);
        logFinancialAction({
          recommendationId: rec.id,
          actionType: rec.actionType,
          actionId,
          status: rec.status,
          merchant: rec.merchant,
          estimatedMonthlySavings: rec.estimatedMonthlySavings,
          severity: rec.severity,
          confidence: rec.confidence,
        });
        return;
      }

      if (def.resolvesTo) {
        applyStatus(rec, actionId, def.resolvesTo);
      }
    },
    [enriched, applyStatus]
  );

  const closeModal = useCallback(() => {
    setModalRecId(null);
  }, []);

  const acceptFromModal = useCallback(() => {
    if (!modalRec) return;
    applyStatus(modalRec, "modal_accept", "accepted");
  }, [modalRec, applyStatus]);

  const resetActions = useCallback(() => {
    clearRecommendationStates();
    setStates({});
    setModalRecId(null);
  }, []);

  return {
    enriched,
    visible,
    acceptedSummary,
    modalRec,
    modalOpen: modalRecId != null,
    modalKind,
    dispatchAction,
    closeModal,
    acceptFromModal,
    resetActions,
    getLastActionId: (recId: string) => states[recId]?.lastActionId,
  };
}
