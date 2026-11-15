import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('public/assets/thanarah-auth.js', 'utf8');
const pages = readdirSync('public', { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      ((): boolean => {
        try {
          return readFileSync(`public/${entry.name}/index.html`, 'utf8').length > 0;
        } catch {
          return false;
        }
      })(),
  )
  .map((entry) => `public/${entry.name}/index.html`);
pages.push('public/index.html');

function harness(mode = 'register') {
  const data = {
    fullName: 'Synthetic Customer',
    email: 'synthetic@example.invalid',
    password: 'SyntheticPass12!',
  };
  const message = { textContent: '', setAttribute: vi.fn() };
  const reference = { textContent: '' };
  const button = { disabled: false, textContent: '' };
  const inputs = [{ readOnly: false }];
  const form = {
    id: 'thanarah-auth-form',
    values: data,
    querySelector: () => button,
    querySelectorAll: () => inputs,
  };
  const dialog = {
    querySelector: (selector: string) =>
      selector === '#thanarah-auth-form'
        ? form
        : selector === '[data-auth-message]'
          ? message
          : reference,
    querySelectorAll: (selector: string) => (selector === 'input' ? inputs : [button]),
    close: vi.fn(),
  };
  const login = vi.fn().mockResolvedValue(true);
  const register = vi.fn().mockResolvedValue({ id: 'synthetic' });
  const me = vi.fn().mockResolvedValue({ id: 'synthetic' });
  const root = {
    CompanyApi: { login },
    JourneyApi: { register, me },
    crypto: { randomUUID: vi.fn().mockReturnValue('synthetic-operation') },
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    scrollTo: vi.fn(),
  } as Record<string, unknown>;
  const context = {
    window: root,
    location: { pathname: '/', search: '' },
    document: {
      readyState: 'loading',
      documentElement: { lang: 'ar' },
      addEventListener: vi.fn(),
      body: { classList: { remove: vi.fn() } },
    },
    FormData: class {
      constructor(private form: { values: typeof data }) {}
      [Symbol.iterator](): IterableIterator<[string, string]> {
        return Object.entries(this.form.values)[Symbol.iterator]();
      }
    },
    CustomEvent: class {
      constructor(
        public type: string,
        public options: unknown,
      ) {}
    },
    URL,
    URLSearchParams,
  };
  runInNewContext(
    source.replace(
      '})(window);',
      `root.testAuth = {
      submit, drafts, filterCountries, normalizePhoneNumber,
      setup: (value, nextMode) => { dialog=value; mode=nextMode; audience='customer'; pagePosition={top:213,left:0}; },
      snapshot: () => ({busy, pendingRegistration, registered})
    }; })(window);`,
    ),
    context,
  );
  const auth = root.testAuth as {
    setup: (dialog: unknown, mode: string) => void;
    submit: (event: unknown) => Promise<void>;
    filterCountries: (query: string) => { region: string; callingCode: string }[];
    normalizePhoneNumber: (value: string, region: string) => string | null;
    snapshot: () => {
      busy: boolean;
      pendingRegistration: { operationId: string } | null;
      registered: boolean;
    };
  };
  auth.setup(dialog, mode);
  const event = { target: form, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
  return {
    auth,
    login,
    register,
    me,
    event,
    data,
    message,
    reference,
    button,
    dialog,
    root,
    inputs,
  };
}

describe('Shared sign-in and customer registration dialog', () => {
  it.each(pages)('loads shared shell and authentication once in order: %s', (page) => {
    const html = readFileSync(page, 'utf8');
    expect(html.match(/src="\/assets\/thanarah-auth.js"/gu)).toHaveLength(1);
    expect(html.match(/src="\/assets\/thanarah-shell.js"/gu)).toHaveLength(1);
    expect(html.match(/href="\/assets\/thanarah-shell.css"/gu)).toHaveLength(1);
    expect(html.indexOf('/assets/thanarah-auth.js')).toBeLessThan(
      html.indexOf('/assets/thanarah-shell.js'),
    );
  });
  it('uses real registration, login and customer permission checks before success', async () => {
    const h = harness();
    await h.auth.submit(h.event);
    expect(h.register).toHaveBeenCalledWith({ ...h.data, operationId: 'synthetic-operation' });
    expect(h.login).toHaveBeenCalledWith(h.data.email, h.data.password);
    expect(h.me).toHaveBeenCalledOnce();
    expect(h.dialog.close).toHaveBeenCalledOnce();
    expect(h.root.dispatchEvent).toHaveBeenCalledTimes(2);
    expect(h.event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(h.root.scrollTo).toHaveBeenCalledWith({ top: 213, left: 0, behavior: 'instant' });
  });
  it('rejects weak registration passwords without calling any endpoint', async () => {
    const h = harness();
    h.data.password = 'weak';
    await h.auth.submit(h.event);
    expect(h.register).not.toHaveBeenCalled();
    expect(h.login).not.toHaveBeenCalled();
    expect(h.message.textContent).toContain('كلمة المرور');
  });
  it('retains the same registration operation and locks fields after an uncertain result', async () => {
    const h = harness();
    h.register.mockRejectedValueOnce({ status: 503, message: 'Unavailable' });
    await h.auth.submit(h.event);
    expect(h.auth.snapshot().pendingRegistration?.operationId).toBe('synthetic-operation');
    expect(h.reference.textContent).toContain('synthetic-operation');
    expect(h.inputs[0].readOnly).toBe(true);
    await h.auth.submit(h.event);
    expect(h.register.mock.calls[1][0]).toEqual(h.register.mock.calls[0][0]);
    expect(h.auth.snapshot().pendingRegistration).toBeNull();
  });
  it('does not register twice when account creation succeeds but login fails', async () => {
    const h = harness();
    h.login.mockRejectedValueOnce({ status: 503, message: 'Unavailable' });
    await h.auth.submit(h.event);
    expect(h.auth.snapshot().registered).toBe(true);
    expect(h.dialog.close).not.toHaveBeenCalled();
    await h.auth.submit(h.event);
    expect(h.register).toHaveBeenCalledOnce();
    expect(h.login).toHaveBeenCalledTimes(2);
  });
  it('retains login fields on failure and does not announce authentication', async () => {
    const h = harness('login');
    h.login.mockRejectedValue({ status: 401, message: 'Invalid credentials' });
    await h.auth.submit(h.event);
    expect(h.data.password).toBe('SyntheticPass12!');
    expect(h.inputs[0].readOnly).toBe(false);
    expect(h.root.dispatchEvent).not.toHaveBeenCalled();
    expect(h.dialog.close).not.toHaveBeenCalled();
  });
  it('prevents double submission while the server is still processing', async () => {
    const h = harness('login');
    let release!: (value: boolean) => void;
    h.login.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = h.auth.submit(h.event);
    await h.auth.submit(h.event);
    await Promise.resolve();
    release(true);
    await first;
    expect(h.login).toHaveBeenCalledOnce();
  });
  it('never reports success for accounts without customer access', async () => {
    const h = harness('login');
    h.me.mockRejectedValue({ status: 403, message: 'Forbidden' });
    await h.auth.submit(h.event);
    expect(h.root.dispatchEvent).not.toHaveBeenCalled();
    expect(h.dialog.close).not.toHaveBeenCalled();
  });
  it('keeps tokens and registration drafts out of persistent browser storage', () => {
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/u);
    expect(source).not.toContain('location.href =');
    expect(source).toContain('dialog.showModal()');
    expect(source).toContain('opener.focus({ preventScroll: true })');
  });
  it('keeps the shared dialog trigger visible and mobile actions on one row', () => {
    const css = readFileSync('public/assets/thanarah-shell.css', 'utf8');
    expect(css).toMatch(/\.thanarah-shell-header\s*\{[^}]*position: sticky;[^}]*top: 0;/u);
    expect(css).toMatch(/\.thanarah-shell-auth-actions\s*\{[^}]*grid-column: 2;[^}]*grid-row: 1;/u);
    expect(readFileSync('public/assets/thanarah-auth.css', 'utf8')).not.toContain(
      'body:has(.thanarah-auth[open])',
    );
  });
  it('keeps the phone option honest and provides no fake verification endpoint', () => {
    expect(source).toContain('التحقق برقم الجوال عبر واتساب غير مفعّل بعد');
    expect(source).toContain('لم تُرسل أي رسالة');
    expect(source).not.toMatch(/\/(?:send-otp|verify-otp|phone-login)/u);
  });
  it('defaults the phone country to Saudi Arabia and searches names and calling codes', () => {
    const h = harness('login');
    expect(h.auth.drafts.login.phoneCountry).toBe('SA');
    expect(h.auth.filterCountries('السعودية').map((country) => country.region)).toContain('SA');
    expect(h.auth.filterCountries('Saudi Arabia').map((country) => country.region)).toContain('SA');
    expect(h.auth.filterCountries('+20').map((country) => country.region)).toContain('EG');
  });
  it('normalizes local and international phone input without authenticating', () => {
    const h = harness('login');
    expect(h.auth.normalizePhoneNumber('٠٥٥ ١٢٣ ٤٥٦٧', 'SA')).toBe('+966551234567');
    expect(h.auth.normalizePhoneNumber('+971 50 123 4567', 'SA')).toBe('+971501234567');
    expect(h.auth.normalizePhoneNumber('00 966 55 123 4567', 'SA')).toBe('+966551234567');
    expect(h.auth.normalizePhoneNumber('020 7946 0018', 'GB')).toBe('+442079460018');
    expect(h.auth.normalizePhoneNumber('06 30 123 4567', 'HU')).toBe('+36301234567');
    expect(h.auth.normalizePhoneNumber('123', 'SA')).toBeNull();
    expect(h.auth.normalizePhoneNumber('0551234567', 'XX')).toBeNull();
    expect(h.login).not.toHaveBeenCalled();
    expect(h.root.dispatchEvent).not.toHaveBeenCalled();
  });
  it('exposes an accessible searchable country picker and keeps verification disabled', () => {
    expect(source).toContain('aria-haspopup="listbox"');
    expect(source).toContain('role="combobox"');
    expect(source).toContain('aria-activedescendant');
    expect(source).toContain('data-country-option');
    expect(source).toContain('type="button" disabled');
  });
});
