export type SapDataSource = "supabase" | "wrapper";

export type MonthTotals = {
  lineCount: number;
  waveCount: number;
  picklistCount: number;
  dayRows: number;
  discrepancyCount?: number;
};

export type DatasetKey = "picking" | "packaging" | "receiving" | "inventory";

export type DatasetCompare = {
  dataset: DatasetKey;
  supabase: MonthTotals;
  wrapper: MonthTotals;
  totalsMatch: boolean;
  detailMatch: boolean;
  detailDiffs: string[];
};

export type MonthCompare = {
  month: string;
  datasets: DatasetCompare[];
  allMatch: boolean;
};
