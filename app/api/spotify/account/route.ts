import { getSession } from "../../../lib/spotify-session";
export async function GET() {
  const session = await getSession();
  return Response.json({ accountId: session?.accountId ?? "guest" }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
}
