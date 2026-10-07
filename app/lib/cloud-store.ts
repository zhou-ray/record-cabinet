import "server-only";
import { emptyCloudLibrary, type CloudLibrary, type CloudState } from "./cloud-library";
export const WRITE_LIBRARY = `
local revision=tonumber(redis.call('HGET',KEYS[1],'revision') or '0')
if revision~=tonumber(ARGV[1]) or redis.call('HGET',KEYS[1],'enabled')=='0' then return -1 end
redis.call('HSET',KEYS[1],'revision',revision+1,'data',ARGV[2],'enabled','1')
return revision+1`;
export const RESET_LIBRARY = `
local revision=redis.call('HINCRBY',KEYS[1],'revision',1)
redis.call('HSET',KEYS[1],'enabled',ARGV[1])
if ARGV[1]=='0' then redis.call('HDEL',KEYS[1],'data') end
return revision`;
export async function command(args: (string | number)[]) {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Cloud storage unavailable");
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args), cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Cloud storage unavailable");
  const data = await response.json();
  if (data.error || data.result === undefined) throw new Error("Cloud storage unavailable");
  return data.result;
}
const key = (account: string) => `record-cabinet:library:${account}`;
export async function readCloud(account: string): Promise<CloudState> {
  const rows = await command(["HGETALL", key(account)]) as string[];
  const fields: Record<string, string> = {};
  for (let i = 0; i < rows.length; i += 2) fields[rows[i]] = rows[i + 1];
  return { revision: Number(fields.revision ?? 0), enabled: fields.enabled !== "0", library: fields.data ? JSON.parse(fields.data) : emptyCloudLibrary() };
}
export async function writeCloud(account: string, revision: number, library: CloudLibrary): Promise<number> {
  return command(["EVAL", WRITE_LIBRARY, 1, key(account), revision, JSON.stringify(library)]);
}
export async function resetCloud(account: string, enabled: boolean): Promise<number> {
  return command(["EVAL", RESET_LIBRARY, 1, key(account), enabled ? "1" : "0"]);
}
