import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
let state: 'loading'|'error'|'empty' = 'loading';
vi.mock('../api', () => ({ useOverviewQuery: () => ({ data:{ provider:'alpaca' } }), useSymbolsQuery: () => state === 'loading' ? ({ isLoading:true }) : state === 'error' ? ({ isError:true, refetch:vi.fn() }) : ({ data:{ symbols:[] } }) }));
import { FeedsPage } from './FeedsPage';
afterEach(cleanup);
describe('symbol REST states', () => { it.each([['loading','Loading symbols…'],['error','Symbols are unavailable'],['empty','No symbols are being monitored']] as const)('renders %s state', (next,text) => { state=next; render(<FeedsPage/>); expect(screen.getByText(text)).toBeInTheDocument(); }); });
