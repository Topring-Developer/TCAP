/**
 * Classification des activités TWMS en catégories :
 * - productive     : travail direct sur les produits
 * - non_productive : travail indirect reconnu
 * - pause_paid     : pause courte payée (< 20 min)
 * - lunch          : dîner non payé (20-75 min entre 11h30-13h30)
 * - pause_abnormal : pause hors fenêtre ou trop longue
 * - unknown        : activité non reconnue → à surveiller
 *
 * Chemin dans TCAP : src/app/api/twms/analyze/classify.ts
 */

export type ActivityCategory =
  | "productive"
  | "non_productive"
  | "pause_paid"
  | "lunch"
  | "pause_abnormal"
  | "unknown";

const PRODUCTIVE = new Set([
  "Expédition",
  "Réception",
  "Picking",
  "Production 901 - Boyaux & Dévidoirs",
  "Production 902 - Cartes",
  "Production 912-920-930",
  "RMA-Emballage-Étiquetage",
  "Réparation",
  "Réparation / Inspection",
  "Contrôle de qualité (CQ)",
  "Gestion inventaire",
  "Gestion",
]);

const NON_PRODUCTIVE = new Set([
  "Production 903",
  "Meeting",
  "Nettoyer, pelleter, bali, mouvement mobilier",
  "Tests, essais, entretien préventif",
  "Tutorat",
  "Kaizen - 5 S",
  "Kaisen - 5 S",
  "Production non-codé / modification produits (S50)",
  "S50",
]);

const LUNCH_START_H  = 11;
const LUNCH_START_M  = 30;
const LUNCH_END_H    = 13;
const LUNCH_END_M    = 30;
const LUNCH_MIN_MIN  = 20;
const LUNCH_MAX_MIN  = 75;
const PAID_BREAK_MAX = 20;

function toMins(h: number, m: number) { return h * 60 + m; }

export function classifyActivity(
  activityName: string,
  startDate: Date,
  durationMin: number
): ActivityCategory {
  const name = activityName.trim();

  if (PRODUCTIVE.has(name))     return "productive";
  if (NON_PRODUCTIVE.has(name)) return "non_productive";

  if (name === "Pause") {
    const startMins  = toMins(startDate.getHours(), startDate.getMinutes());
    const lunchStart = toMins(LUNCH_START_H, LUNCH_START_M);
    const lunchEnd   = toMins(LUNCH_END_H, LUNCH_END_M);

    if (durationMin < PAID_BREAK_MAX) {
      return "pause_paid";
    }
    if (
      durationMin >= LUNCH_MIN_MIN &&
      durationMin <= LUNCH_MAX_MIN &&
      startMins   >= lunchStart &&
      startMins   <= lunchEnd
    ) {
      return "lunch";
    }
    return "pause_abnormal";
  }

  return "unknown";
}

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  productive:     "Productif",
  non_productive: "Non-productif",
  pause_paid:     "Pause payée",
  lunch:          "Dîner non payé",
  pause_abnormal: "Pause anormale",
  unknown:        "Non conforme",
};

export const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  productive:     "#22c55e",
  non_productive: "#f59e0b",
  pause_paid:     "#60a5fa",
  lunch:          "#94a3b8",
  pause_abnormal: "#ef4444",
  unknown:        "#dc2626",
};
