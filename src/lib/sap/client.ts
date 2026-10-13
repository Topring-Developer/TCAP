/**
 * Client serveur pour le wrapper SAP TCAP.
 * Secrets uniquement via process.env — jamais exposés au navigateur.
 */

export type SapDataset = "picking" | "packaging" | "receiving" | "inventory";

export type SapPickingLine = {
  userCode: string;
  userName: string;
  waveKey: string;
  pickListNumber: number;
  lineNum: number;
  createDate: string;
  createTime: number;
  itemCode: string;
};

export type SapReceivingLine = {
  docDate: string;
  employeeName: string;
  count: number;
};

export type SapInventoryLine = {
  id: string;
  date: string;
  userName: string;
  itemCode: string;
  location: string;
  result: string;
};

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable manquante: ${name}`);
  return v;
}

function baseUrl(): string {
  return requireEnv("WRAPPER_BASE_URL").replace(/\/$/, "");
}

function cfHeaders(): Record<string, string> {
  return {
    "CF-Access-Client-Id": requireEnv("CF_ACCESS_CLIENT_ID"),
    "CF-Access-Client-Secret": requireEnv("CF_ACCESS_CLIENT_SECRET"),
  };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.token;
  }

  const res = await fetch(`${baseUrl()}/api/v1/auth/service-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...cfHeaders(),
    },
    body: JSON.stringify({
      client_id: requireEnv("WRAPPER_CLIENT_ID"),
      client_secret: requireEnv("WRAPPER_CLIENT_SECRET"),
      scopes: ["tcap:read"],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Auth wrapper ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokenCache = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 300) * 1000,
  };
  return tokenCache.token;
}

async function fetchPage<T>(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T[]> {
  const token = await getAccessToken();
  const url = new URL(`${baseUrl()}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      ...cfHeaders(),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Wrapper ${path} ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data?: T[] };
  return json.data ?? [];
}

/** Paginate until a page returns fewer than limit rows. */
export async function fetchAllPages<T>(
  path: string,
  dateFrom: string,
  dateTo: string,
  limit = 10_000
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage<T>(path, {
      dateFrom,
      dateTo,
      limit,
      offset,
    });
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

export async function fetchPicking(
  dateFrom: string,
  dateTo: string
): Promise<SapPickingLine[]> {
  return fetchAllPages<SapPickingLine>("/api/v1/tcap/picking", dateFrom, dateTo);
}

export async function fetchPackaging(
  dateFrom: string,
  dateTo: string
): Promise<SapPickingLine[]> {
  return fetchAllPages<SapPickingLine>(
    "/api/v1/tcap/packaging",
    dateFrom,
    dateTo
  );
}

export async function fetchReceiving(
  dateFrom: string,
  dateTo: string
): Promise<SapReceivingLine[]> {
  return fetchAllPages<SapReceivingLine>(
    "/api/v1/tcap/receiving",
    dateFrom,
    dateTo
  );
}

export async function fetchInventory(
  dateFrom: string,
  dateTo: string
): Promise<SapInventoryLine[]> {
  return fetchAllPages<SapInventoryLine>(
    "/api/v1/tcap/inventory",
    dateFrom,
    dateTo
  );
}

export function monthBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}
