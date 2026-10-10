import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LinkConfirmation } from '../src/link-confirmation';
const code = 'a'.repeat(32);
beforeEach(() => {
  window.Telegram = { WebApp: { initData: new URLSearchParams({ start_param: `link_${code}`, user: '{"id":123}' }).toString(), ready: vi.fn(), expand: vi.fn(), close: vi.fn(), BackButton: { isVisible: false, show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() } } };
});
afterEach(() => { cleanup(); delete window.Telegram; vi.unstubAllGlobals(); });
describe('Telegram connection confirmation', () => {
  it('makes no request until explicitly confirmed and never requests a journal', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ linked: true })));
    vi.stubGlobal('fetch', fetcher);
    render(<LinkConfirmation onCancel={vi.fn()} />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить подключение' }));
    await screen.findByText('Telegram подключён');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toContain('/mobile/confirm'); expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ code });
    expect(options.headers.Authorization).toBe(`tma ${window.Telegram!.WebApp.initData}`);
  });
  it('blocks an invalid challenge and cancellation sends no request', () => {
    const cancel = vi.fn(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    window.Telegram!.WebApp.initData = 'start_param=link_bad';
    render(<LinkConfirmation onCancel={cancel} />);
    expect(screen.getByRole('button', { name: 'Подтвердить подключение' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Не подключать — открыть журнал' }));
    expect(cancel).toHaveBeenCalledTimes(1); expect(fetcher).not.toHaveBeenCalled();
  });
  it('handles an expired code without claiming success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 409 })));
    render(<LinkConfirmation onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить подключение' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Telegram подключён')).toBeNull();
  });
});
