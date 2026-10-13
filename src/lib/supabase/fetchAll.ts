const PAGE_SIZE = 1000;

type FetchResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * Charge toutes les lignes d'une requête Supabase en paginant par chunks de 1000.
 * Contourne la limite PostgREST par défaut.
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<FetchResult<T>>
): Promise<{ data: T[]; error: string | null }> {
  const all: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await buildQuery(offset, offset + PAGE_SIZE - 1);
    if (error) return { data: all, error: error.message };

    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { data: all, error: null };
}
