import { findColumnIndex } from "./production";

async function loadXlsx() {
  const mod = await import("xlsx");
  return mod.default ?? mod;
}

type CellLike = { w?: string; t?: string; v?: unknown };

function formatCell(cell: CellLike): string {
  if (cell.w) return String(cell.w).trim();
  if (cell.t === "s") return String(cell.v).trim();
  if (cell.t === "n") return String(cell.v);
  return String(cell.v ?? "").trim();
}

/** Lit un fichier Excel et retourne les lignes de la première feuille avec en-têtes */
export async function readExcelFile(file: File): Promise<{ headers: string[]; rows: unknown[][] }> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true, raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const ws = wb.Sheets[sheetName]!;
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (data.length === 0) return { headers: [], rows: [] };

  const headers = (data[0] as unknown[]).map((h) => String(h ?? "").trim());
  const rows = data.slice(1).filter((row) =>
    (row as unknown[]).some((cell) => cell !== "" && cell != null)
  ) as unknown[][];

  return { headers, rows };
}

/** Version enrichie qui lit les items via cell.w pour préserver l'affichage Excel */
export async function readExcelWithFormattedItems(file: File): Promise<{
  headers: string[];
  rows: unknown[][];
  itemColIndex: number;
}> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [], itemColIndex: -1 };

  const ws = wb.Sheets[sheetName]!;
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  });

  if (data.length === 0) return { headers: [], rows: [], itemColIndex: -1 };

  const headers = (data[0] as unknown[]).map((h) => String(h ?? "").trim());
  const itemColIndex = findColumnIndex(headers, ["item", "article"]);

  const rows: unknown[][] = [];
  for (let i = 1; i < data.length; i++) {
    const row = [...(data[i] as unknown[])];
    if (!row.some((cell) => cell !== "" && cell != null)) continue;

    if (itemColIndex >= 0) {
      const addr = XLSX.utils.encode_cell({ r: i, c: itemColIndex });
      const cell = ws[addr] as CellLike | undefined;
      const formatted = cell ? formatCell(cell) : String(row[itemColIndex] ?? "").trim();
      if (formatted) row[itemColIndex] = formatted;
    }
    rows.push(row);
  }

  return { headers, rows, itemColIndex };
}
