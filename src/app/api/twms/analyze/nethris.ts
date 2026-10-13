/**
 * Agrégation Nethris côté serveur.
 * Le parsing XLSX est fait côté client (src/utils/parseNethrisClient.ts).
 * Ce fichier reçoit les lignes déjà parsées et les agrège par employé × jour.
 *
 * Chemin dans TCAP : src/app/api/twms/analyze/nethris.ts
 *
 * ⚠️  NAME_MAP  — si TCAP utilise déjà Supabase pour les noms, cette table
 *     peut être remplacée par une requête sur employee_system_mapping.
 *     Pour l'instant, elle est conservée en dur pour ne pas bloquer la migration.
 */

// ── Table de correspondance Nethris → clé TWMS ────────────────────────────────
// Format Nethris : "NOM, PRENOM"
// Format TWMS    : "Prénom Nom" (tel que généré par la fonction key())
const NAME_MAP: Record<string, string> = {
  "ARCHAMBAULT, STEPHANE":       "Stéphane Archambault",
  "ARCHAMBAULT, STÉPHANE":       "Stéphane Archambault",
  "BISSONNETTE, MARCEL":         "Marcel Bissonnette",
  "BOUHLOUL, RABAH":             "Rabah Bouhloul",
  "DANIS, LUCIE":                "Lucie Danis",
  "DAUNAIS, SYLVAIN":            "Sylvain Daunais",
  "DAVIS-SANSCHAGRIN, ALYSON":   "Alyson Davis-Sanschagrin",
  "GRONDIN, MARIE-PIER":         "Marie-Pier Grondin",
  "HRYCYK, ROXANNE":             "Roxane Hrycyk",
  "HRYCYK, ROXANE":              "Roxane Hrycyk",
  "LAROCQUE, LUCAS":             "Lucas Larocque",
  "LESAGE, MARIE-EVE":           "Marie-Eve Lesage",
  "LESAGE, MARIE-ÈVE":          "Marie-Eve Lesage",
  "POPOVA, EKATERINA":           "Ekaterina Popova",
  "POULIN, SHAWN":               "Shawn Poulin",
  "RODRIGUE, LOUIS":             "Louis Rodrigue",
  "RONDEAU, SYLVIE":             "Sylvie Rondeau",
  "VALLEJO, VALENTINA":          "Valentina Vallejo",
  "VOLNY, JUDE":                 "Jude Volny",
  "WALTZ, JEAN-SEBASTIEN":       "Jean Sébastien Waltz",
  "WALTZ, JEAN-SÉBASTIEN":      "Jean Sébastien Waltz",
  "GAUTHIER, YANN":              "Yann Gauthier",
  "NADEAU, JEREMY":              "Jérémy Nadeau",
  "NADEAU, JÉRÉMY":             "Jérémy Nadeau",
  "Nadeau, Jérémy":              "Jérémy Nadeau",
  "LACHANCE, FREDERIC":          "Frédérick Lachance",
  "LACHANCE, FRÉDÉRICK":        "Frédérick Lachance",
  "Lachance, Frédérick":         "Frédérick Lachance",
  // L'Heureux, André = "Réparation" dans TWMS
  "L'HEUREUX, ANDRE":            "Réparation",
  "L'HEUREUX, ANDRÉ":           "Réparation",
  // Exclusions — superviseur, hors entrepôt ou non analysés
  "BEAUREGARD, MICHEL":          "__EXCLUDE__",
  "FERLAND, JEAN":               "__EXCLUDE__",
  "HEBERT, MIKAEL":              "__EXCLUDE__",
  "BUEE, CYRIL":                 "__EXCLUDE__",
};

export interface NethrisDay {
  twmsKey:  string;
  date:     string;   // YYYY-MM-DD
  hresReg:  number;   // G1 HRES REGULIERES
  hresSupp: number;   // G43 HRES SUPPL.
  isAbsent: boolean;  // vacances / férié / congé flex
}

interface RawRow {
  nom:   string;
  date:  string;
  type:  string;
  hours: number;
}

function normalizeName(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

function twmsKey(nethrisName: string): string | null {
  const raw = nethrisName.trim().replace(/\s+/g, " ");
  if (NAME_MAP[raw] !== undefined) {
    return NAME_MAP[raw] === "__EXCLUDE__" ? null : NAME_MAP[raw];
  }
  const norm = normalizeName(raw);
  const mapped = NAME_MAP[norm];
  if (!mapped)              return null;
  if (mapped === "__EXCLUDE__") return null;
  return mapped;
}

function aggregateRows(rows: RawRow[]): NethrisDay[] {
  const map: Record<string, { hresReg: number; hresSupp: number; absenceHrs: number }> = {};

  const ABSENT_TYPES = new Set(["G106 Congés Flex", "G109 Hres Vacances", "G124 CONGÉ FÉRIÉ", "G124 CONGE FERIE"]);

  for (const r of rows) {
    const k = twmsKey(r.nom);
    if (!k) continue;

    const mk = `${k}||${r.date}`;
    if (!map[mk]) map[mk] = { hresReg: 0, hresSupp: 0, absenceHrs: 0 };

    if (r.type === "G1 HRES REGULIERES")  map[mk].hresReg  += r.hours;
    if (r.type === "G43 HRES SUPPL.")     map[mk].hresSupp += r.hours;
    if (ABSENT_TYPES.has(r.type))         map[mk].absenceHrs += r.hours;
  }

  return Object.entries(map)
    .map(([mk, v]) => {
      const [twmsK, date] = mk.split("||");
      return {
        twmsKey:  twmsK,
        date,
        hresReg:  Math.round(v.hresReg * 100) / 100,
        hresSupp: Math.round(v.hresSupp * 100) / 100,
        isAbsent: v.hresReg === 0 && v.absenceHrs > 0,
      };
    })
    .filter(d => d.hresReg > 0 || d.isAbsent);
}

export function aggregateNethrisRows(
  rows: Array<{ nom: string; date: string; type: string; hours: number }>
): NethrisDay[] {
  return aggregateRows(rows as RawRow[]);
}
