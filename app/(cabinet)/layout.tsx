import { Suspense } from "react";
import AccountProvider from "../account-context";
import LibraryScreen from "../library-screen";
import { mockLibrary } from "../data/mock";
import { getSession } from "../lib/spotify-session";

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const connected = !!session?.accountId;
  return <AccountProvider accountId={session?.accountId ?? "guest"}><Suspense fallback={<p className="library-storage-status">Opening your cabinet…</p>}><LibraryScreen connected={connected} demo={await mockLibrary.getAlbums()} legacySession={!!session && !connected} /></Suspense>{children}</AccountProvider>;
}
