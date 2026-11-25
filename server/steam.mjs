// Steam Store search needs no API key. Keep this external dependency behind the API
// so native clients and browsers share timeouts, caching, and error handling.
export function createSteamSearch(fetcher = fetch) {
  const cache = new Map();
  return async (query) => {
    const key = query.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) return cached.items;
    const url = new URL('https://store.steampowered.com/api/storesearch/');
    url.search = new URLSearchParams({ term: query, l: 'russian', cc: 'us' }).toString();
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Steam search unavailable');
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error('Invalid Steam response');
    const items = data.items
      .filter(
        (item) =>
          item.type === 'app' &&
          Number.isInteger(item.id) &&
          item.id > 0 &&
          typeof item.name === 'string',
      )
      .slice(0, 30)
      .map((item) => ({ id: item.id, name: item.name.slice(0, 200) }));
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { until: Date.now() + 300000, items });
    return items;
  };
}
