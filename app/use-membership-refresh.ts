"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "./account-context";
import { createMembershipRefresh, emptyMembershipProgress } from "./lib/membership-refresh";

/** No requests on mount; the future discovery panel calls start explicitly. */
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
  return { progress: result.accountId === accountId ? result.progress : emptyMembershipProgress(), start: () => current.current?.start(), cancel: () => current.current?.cancel() };
}
