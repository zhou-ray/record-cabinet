import { accountMatches, config, getSession } from "../../../lib/spotify-session";
import { parseCloudLibrary } from "../../../lib/cloud-library";
import { readCloud, resetCloud, writeCloud } from "../../../lib/cloud-store";
const headers = { "Cache-Control": "private, no-store" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
async function handle(request: Request) {
  const session = await getSession();
  if (!session?.accountId) return json({ error: "Sign into Spotify to sync your library." }, 401);
  if (!accountMatches(session, request)) return json({ error: "Account changed. Reload your collection." }, 409);
  if (request.method !== "GET" && request.headers.get("origin") !== config(request).origin) return json({ error: "Invalid request origin." }, 403);
  try {
    if (request.method === "GET") return json(await readCloud(session.accountId));
    if (request.method === "DELETE" || request.method === "POST") {
      const enabled = request.method === "POST";
      await resetCloud(session.accountId, enabled);
      return json({ enabled });
    }
    if (Number(request.headers.get("content-length") ?? 0) > 3_000_000) return json({ error: "This library exceeds the current 3 MB cloud limit. Your local records are safe." }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 3_000_000) return json({ error: "This library exceeds the current 3 MB cloud limit. Your local records are safe." }, 413);
    let revision: number, library;
    try {
      const body = JSON.parse(raw);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error();
      revision = body.revision; library = parseCloudLibrary(body.library);
    } catch { return json({ error: "Invalid library data." }, 400); }
    const next = await writeCloud(session.accountId, revision, library);
    if (next < 0) return json({ error: "Another device updated the library. Sync again." }, 412);
    return json({ revision: next, enabled: true, library });
  } catch { return json({ error: "Cloud sync is temporarily unavailable. Your local records are safe." }, 503); }
}
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
export const POST = handle;
