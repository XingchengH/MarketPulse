import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../api', () => ({ useAlertsQuery: () => ({ data:{ alerts:[] } }), useSessionQuery: () => ({ data:{ user:{ name:'Morgan Lee', role:'viewer' } } }) }));
import { AppShell } from './AppShell';
describe('responsive application shell semantics', () => { it('exposes landmark navigation and a mobile menu control', () => { render(<MemoryRouter><AppShell><h1>Workspace content</h1></AppShell></MemoryRouter>); expect(screen.getByRole('navigation')).toBeInTheDocument(); expect(screen.getByRole('button',{name:'Open navigation'})).toBeInTheDocument(); expect(screen.getByRole('link',{name:/Overview/})).toHaveAttribute('aria-current','page'); expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading',{name:'Workspace content'})); }); });
