import { describe, expect, it, vi } from 'vitest';
import { AssetDirectory } from './asset-directory.js';
import type { ProviderAsset } from './provider.js';

const asset = (symbol: string, name = 'Example Company', overrides: Partial<ProviderAsset> = {}): ProviderAsset => ({
  symbol, name, exchange: 'NASDAQ', assetClass: 'us_equity', status: 'active', tradable: true, ...overrides,
});

describe('AssetDirectory', () => {
  it('ranks exact symbol, symbol prefix, company prefix, and company substring with alphabetic ties', async () => {
    const listAssets = vi.fn(async () => [
      asset('ZZZ', 'The Apple Company'), asset('ZX', 'Apple Zebra'), asset('APPZ'),
      asset('ABA', 'The Apple Company'), asset('APP'), asset('AAP', 'Apple Alpha'), asset('APPA'), asset('OTHER'),
    ]);
    const directory = new AssetDirectory({ listAssets });
    const results = await directory.search('  aPp  ');
    expect(results.map(result => result.symbol)).toEqual(['APP', 'APPA', 'APPZ', 'AAP', 'ZX', 'ABA', 'ZZZ']);
    expect(results[0]).toEqual({ symbol: 'APP', companyName: 'Example Company', exchange: 'NASDAQ', assetClass: 'us_equity', tradable: true });
  });

  it('normalizes and filters ineligible or malformed assets before caching', async () => {
    const listAssets = vi.fn(async () => [
      asset(' app ', ' Apple Inc. ', { exchange: ' NASDAQ ' }), asset('NOEX', 'Apple No Exchange', { exchange: undefined }),
      asset('INACTIVE', 'Apple Inactive', { status: 'inactive' }), asset('HALT', 'Apple Halted', { tradable: false }),
      { ...asset('CRYPTO', 'Apple Crypto'), assetClass: 'crypto' }, { ...asset('UNKNOWN', 'Apple Unknown'), status: 'unknown' },
      asset('', 'Apple Empty Symbol'), asset('BAD/SYMBOL', 'Apple Malformed Symbol'), asset('EMPTY', ' '),
      { ...asset('BADNAME'), name: 10 }, { ...asset('BADBOOL', 'Apple Bad Boolean'), tradable: 'true' }, null,
    ] as unknown as ProviderAsset[]);
    const directory = new AssetDirectory({ listAssets });
    expect(await directory.search('apple')).toEqual([
      { symbol: 'APP', companyName: 'Apple Inc.', exchange: 'NASDAQ', assetClass: 'us_equity', tradable: true },
      { symbol: 'NOEX', companyName: 'Apple No Exchange', assetClass: 'us_equity', tradable: true },
    ]);
    await directory.search('APP');
    expect(listAssets).toHaveBeenCalledTimes(1);
  });

  it('returns no results for empty, whitespace, or one-character queries without fetching', async () => {
    const listAssets = vi.fn(async () => [asset('APP')]);
    const directory = new AssetDirectory({ listAssets });
    for (const query of ['', '   ', 'a', ' a ']) expect(await directory.search(query)).toEqual([]);
    expect(listAssets).not.toHaveBeenCalled();
  });

  it('caps results at ten by default and supports a smaller configured limit', async () => {
    const listAssets = vi.fn(async () => Array.from({ length: 15 }, (_, index) => asset(`AA${String(14 - index).padStart(2, '0')}`)));
    expect((await new AssetDirectory({ listAssets }).search('aa')).map(result => result.symbol))
      .toEqual(Array.from({ length: 10 }, (_, index) => `AA${String(index).padStart(2, '0')}`));
    expect((await new AssetDirectory({ listAssets }, { maxResults: 2 }).search('aa')).map(result => result.symbol)).toEqual(['AA00', 'AA01']);
  });

  it('uses the default fifteen-minute TTL and refreshes at expiry', async () => {
    let now = 0;
    const listAssets = vi.fn().mockResolvedValueOnce([asset('APP')]).mockResolvedValueOnce([asset('APPL')]);
    const directory = new AssetDirectory({ listAssets }, { now: () => now });
    expect((await directory.search('app'))[0].symbol).toBe('APP');
    now = 15 * 60_000 - 1;
    expect((await directory.search('app'))[0].symbol).toBe('APP');
    expect(listAssets).toHaveBeenCalledTimes(1);
    now += 1;
    expect((await directory.search('app'))[0].symbol).toBe('APPL');
    expect(listAssets).toHaveBeenCalledTimes(2);
  });

  it('serves the last successful directory on refresh failure and retries to recover', async () => {
    let now = 0;
    const listAssets = vi.fn().mockResolvedValueOnce([asset('APP')]).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([asset('APPL')]);
    const directory = new AssetDirectory({ listAssets }, { now: () => now, ttlMs: 10 });
    await directory.search('app'); now = 10;
    expect((await directory.search('app'))[0].symbol).toBe('APP');
    expect((await directory.search('app'))[0].symbol).toBe('APPL');
    expect(listAssets).toHaveBeenCalledTimes(3);
  });

  it('retains an empty successful cache as a stale fallback', async () => {
    let now = 0;
    const listAssets = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('unavailable'));
    const directory = new AssetDirectory({ listAssets }, { now: () => now, ttlMs: 10 });
    await directory.search('app'); now = 10;
    await expect(directory.search('app')).resolves.toEqual([]);
  });

  it('propagates initial provider failures and clears the in-flight request for retry', async () => {
    const listAssets = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([asset('APP')]);
    const directory = new AssetDirectory({ listAssets });
    await expect(directory.search('app')).rejects.toThrow('unavailable');
    expect((await directory.search('app'))[0].symbol).toBe('APP');
    expect(listAssets).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight request across concurrent searches on first load and refresh', async () => {
    let now = 0;
    let resolve!: (assets: ProviderAsset[]) => void;
    const listAssets = vi.fn(() => new Promise<ProviderAsset[]>(done => { resolve = done; }));
    const directory = new AssetDirectory({ listAssets }, { now: () => now, ttlMs: 10 });
    const first = directory.search('app'); const second = directory.search('example');
    expect(listAssets).toHaveBeenCalledTimes(1);
    resolve([asset('APP')]);
    expect((await Promise.all([first, second])).map(results => results[0].symbol)).toEqual(['APP', 'APP']);
    now = 10;
    const third = directory.search('app'); const fourth = directory.search('example');
    expect(listAssets).toHaveBeenCalledTimes(2);
    resolve([asset('APPL')]);
    expect((await Promise.all([third, fourth])).map(results => results[0].symbol)).toEqual(['APPL', 'APPL']);
  });
});
