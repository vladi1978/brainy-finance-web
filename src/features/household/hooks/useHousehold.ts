"use client";

import { useCallback, useEffect, useState } from "react";
import type { Household } from "../types";
import {
  addHouseholdMember as addHouseholdMemberApi,
  createHousehold as createHouseholdApi,
  getCurrentHousehold,
  removeHouseholdMember as removeHouseholdMemberApi,
} from "../services/householdService";

type Status = "idle" | "loading" | "error";

export function useHousehold() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading !== false;
    if (showLoading) {
      setStatus("loading");
    }
    setError(null);
    try {
      const h = await getCurrentHousehold();
      setHousehold(h);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load household");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const h = await getCurrentHousehold();
        if (!cancelled) {
          setHousehold(h);
          setStatus("idle");
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load household"
          );
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const createHousehold = useCallback(async (name: string) => {
    setStatus("loading");
    setError(null);
    try {
      const h = await createHouseholdApi(name);
      setHousehold(h);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create household");
      setStatus("error");
    }
  }, []);

  const addMember = useCallback(
    async (input: Parameters<typeof addHouseholdMemberApi>[0]) => {
      setStatus("loading");
      setError(null);
      try {
        const h = await addHouseholdMemberApi(input);
        setHousehold(h);
        setStatus("idle");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add member");
        setStatus("error");
      }
    },
    []
  );

  const removeMember = useCallback(async (memberId: string) => {
    setStatus("loading");
    setError(null);
    try {
      const h = await removeHouseholdMemberApi(memberId);
      setHousehold(h);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove member");
      setStatus("error");
    }
  }, []);

  return {
    household,
    status,
    error,
    refresh,
    createHousehold,
    addMember,
    removeMember,
    isLoading: status === "loading",
  };
}
