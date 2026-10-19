"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "./account-context";
import { createMembershipRefresh, emptyMembershipProgress } from "./lib/membership-refresh";

/** No requests on mount. One explicit run owns the account lock across all batches. */
export function useMembershipRefresh() {
  const { accountId, storage, apiFetch } = useAccount();
  const [result, setResult] = useState(() => ({ accountId, progress: emptyMembershipProgress() }));
  const current = useRef<ReturnType<typeof createMembershipRefresh> | null>(null);
  useEffect(() => {
    const refresh = createMembershipRefresh({ accountId, storage, apiFetch, progress: progress => setResult({ accountId, progress }) });
    current.current = refresh;
    // Permanent for this mounted controller: don't allow a new run while deletion drains.
    const remove = () => refresh.dispose();
    window.addEventListener("record-cabinet-removing-local", remove);
    return () => {
      refresh.dispose(); current.current = null;
      window.removeEventListener("record-cabinet-removing-local", remove);
    };
  }, [accountId, storage, apiFetch]);
  return { progress: result.accountId === accountId ? result.progress : emptyMembershipProgress(), start: async () => {
    const refresh = current.current;
    if (!refresh) return;
    if (!navigator.locks) throw new Error("Saved-album checks need a browser with Web Locks support.");
    await navigator.locks.request(`record-cabinet-membership:${accountId}`, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("Saved albums are being checked in another tab. Try again when it finishes.");
      if (current.current === refresh) await refresh.start();
    });
  }, cancel: () => current.current?.cancel() };
}
