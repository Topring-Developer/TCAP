/**
 * Preload Node (hors webpack) — certains réseaux bloquent une IP Cloudflare
 * de Supabase. On pin undici sur la première IP HTTPS joignable.
 *
 * Utilisé via: node --import ./scripts/pin-supabase-dns.mjs ...
 */
import dns from "node:dns";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setGlobalDispatcher, Agent } from "undici";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function readEnvLocalUrl() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
  try {
    const envPath = path.join(root, ".env.local");
    const text = fs.readFileSync(envPath, "utf8");
    const match = text.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
    return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
  } catch {
    return null;
  }
}

function httpsReachable(hostname, address, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: address,
        servername: hostname,
        path: "/auth/v1/health",
        method: "GET",
        timeout: timeoutMs,
        headers: { Host: hostname },
      },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

const supabaseUrl = readEnvLocalUrl();
if (!supabaseUrl) {
  console.warn("[pin-supabase-dns] NEXT_PUBLIC_SUPABASE_URL introuvable — skip");
} else {
  let hostname;
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    hostname = null;
  }

  if (hostname) {
    const addresses = await dns.promises.lookup(hostname, { all: true, family: 4 });
    let pinnedIp = null;
    for (const { address } of addresses) {
      if (await httpsReachable(hostname, address)) {
        pinnedIp = address;
        break;
      }
    }

    if (!pinnedIp) {
      console.warn(
        `[pin-supabase-dns] Aucune IP HTTPS joignable pour ${hostname}`
      );
    } else {
      console.log(`[pin-supabase-dns] Supabase via ${pinnedIp} (${hostname})`);
      const originalLookup = dns.lookup.bind(dns);
      setGlobalDispatcher(
        new Agent({
          connect: {
            lookup(host, options, callback) {
              if (host === hostname) {
                if (options?.all) {
                  callback(null, [{ address: pinnedIp, family: 4 }]);
                  return;
                }
                callback(null, pinnedIp, 4);
                return;
              }
              originalLookup(host, options, callback);
            },
          },
        })
      );
    }
  }
}
