import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config, FLOW, SESSION, getSession, accountMatches } from "../../../lib/spotify-session";
export async function POST(request: Request) {
  const { origin } = config(request);
  if (request.headers.get("origin") !== origin) return new Response("Forbidden", { status: 403 });
  const session = await getSession();
  if (session?.accountId && !accountMatches(session, request)) return Response.json({ error: "The account changed. Reload before signing out." }, { status: 409 });
  const store = await cookies();
  store.delete(SESSION);
  store.delete(FLOW);
  return NextResponse.redirect(new URL("/", origin), 303);
}
