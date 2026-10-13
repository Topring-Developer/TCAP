/**
 * Parseur Nethris côté CLIENT (navigateur)
 * Gère CSV et Excel — xlsx fonctionne parfaitement dans le navigateur
 *
 * Chemin dans TCAP : src/utils/parseNethrisClient.ts  (inchangé)
 */

export interface NethrisRawRow {
  nom: string;
  date: string;
  type: string;
  hours: number;
}

function dateToStr(val: unknown): string {
  if (val instanceof Date) {
    // SheetJS génère des dates à minuit UTC — utiliser getUTC* pour éviter le décalage UTC-4
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, "0");
    const d = String(val.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof val === "number" && val > 0) {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(val ?? "").trim();
}

async function parseXlsx(buffer: ArrayBuffer): Promise<NethrisRawRow[]> {
  const XLSX = await import("xlsx");
  const wb  = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][];

  let nomIdx = -1, dateIdx = -1, typeIdx = -1, hrsIdx = -1, dataStart = -1;

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i].map(c => String(c ?? "").toLowerCase().trim());
    const nIdx = row.findIndex(c => c.includes("nom") && c.includes("pr"));
    if (nIdx === -1) continue;
    const dIdx = row.findIndex(c => c === "date");
    const tIdx = row.findIndex(c => c.includes("gain") || c.includes("type"));
    const hIdx = row.findIndex(c => c.includes("hrs") || c.includes("nombre") || c.includes("heure"));
    if (dIdx !== -1 && tIdx !== -1 && hIdx !== -1) {
      nomIdx = nIdx; dateIdx = dIdx; typeIdx = tIdx; hrsIdx = hIdx;
      dataStart = i + 1;
      break;
    }
  }

  if (dataStart === -1) return [];

  const rows: NethrisRawRow[] = [];
  for (let i = dataStart; i < raw.length; i++) {
    const row  = raw[i] as unknown[];
    const nom  = String(row[nomIdx]  ?? "").trim();
    const type = String(row[typeIdx] ?? "").trim();
    const hours = parseFloat(String(row[hrsIdx] ?? "0")) || 0;
    if (!nom || !type) continue;
    const date = dateToStr(row[dateIdx]);
    if (!date) continue;
    rows.push({ nom, date, type, hours });
  }
  return rows;
}

function parseCsv(csvText: string): NethrisRawRow[] {
  const rows: NethrisRawRow[] = [];
  let headerFound = false;
  for (const line of csvText.split(/\r?\n/)) {
    const cols = line.split(";");
    if (!headerFound) {
      if (cols[0]?.toLowerCase().includes("nom")) headerFound = true;
      continue;
    }
    const nom   = (cols[0] ?? "").trim();
    const date  = (cols[1] ?? "").trim();
    const type  = (cols[2] ?? "").trim();
    const hours = parseFloat((cols[3] ?? "0").trim()) || 0;
    if (!nom || !date || !type) continue;
    rows.push({ nom, date, type, hours });
  }
  return rows;
}

export async function parseNethrisFile(file: File): Promise<NethrisRawRow[]> {
  const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
  if (isExcel) {
    const buffer = await file.arrayBuffer();
    return parseXlsx(buffer);
  }
  const text = await file.text();
  return parseCsv(text);
}
