import { createAuthClient } from '@neon/auth';
import { bootstrapClayStandalone } from '../../clay-sync/standalone-bootstrap.js';

const root = document.createElement('main');
root.id = 'clay-auth-root';
root.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg,#f3ece1);color:var(--ink,#2b211a);font:16px/1.5 system-ui,sans-serif';
document.body.append(root);

function showMessage(message, isError = false) {
  const node = root.querySelector('[data-message]');
  if (node) {
    node.textContent = message;
    node.style.color = isError ? '#9b2c1c' : 'inherit';
  }
}

function renderSignIn() {
  root.innerHTML = `
    <section style="width:min(100%,420px);padding:32px;border-radius:24px;background:var(--surface,#fbf8f2);border:1px solid var(--line,#e2d7c6);box-shadow:0 12px 40px #2b211a12">
      <p style="letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:var(--accent,#94482b);font-weight:700">Clay · Your personal care space</p>
      <h1 style="font:500 38px/1.1 Georgia,serif;margin:14px 0">Welcome back</h1>
      <p style="margin:0 0 24px;color:var(--muted,#6b5b4d)">Enter your email and we’ll send you a secure sign-in link. Clay accounts are invitation-only for now.</p>
      <form data-sign-in>
        <label for="clay-email" style="display:block;font-weight:600;margin-bottom:8px">Email address</label>
        <input id="clay-email" name="email" type="email" autocomplete="email" required style="width:100%;padding:14px;border:1px solid var(--line,#e2d7c6);border-radius:12px;font:inherit;background:transparent;color:inherit">
        <button type="submit" style="width:100%;margin-top:16px;padding:14px;border:0;border-radius:999px;background:var(--accent,#94482b);color:white;font:inherit;font-weight:700">Email me a sign-in link</button>
      </form>
      <p data-message role="status" aria-live="polite" style="min-height:24px;margin-top:16px"></p>
      <p style="font-size:12px;color:var(--muted,#6b5b4d)">New account creation is disabled. If you need access, contact the Clay workspace owner.</p>
    </section>`;
}

async function start() {
  try {
    const configResponse = await fetch('/api/clay/config', { cache: 'no-store' });
    if (!configResponse.ok) throw new Error('Clay sign-in is not configured for this environment yet.');
    const config = await configResponse.json();
    const authClient = createAuthClient(config.authBaseUrl);
    const result = await bootstrapClayStandalone({
      authClient,
      storage: window.localStorage,
      fetchImpl: window.fetch.bind(window),
      hostGlobal: window,
      callbackURL: window.location.origin + window.location.pathname,
      loadApp: async () => {
        await import('./clay-app.js');
        root.remove();
      }
    });

    if (result.status === 'signed_out') {
      renderSignIn();
      root.querySelector('[data-sign-in]').addEventListener('submit', async event => {
        event.preventDefault();
        const submit = root.querySelector('button[type="submit"]');
        submit.disabled = true;
        showMessage('Sending your secure sign-in link…');
        try {
          const email = new FormData(event.currentTarget).get('email');
          await result.requestEmailSignIn(email);
          showMessage('If this email belongs to an existing Clay account, a sign-in link is on its way.');
          event.currentTarget.reset();
        } catch (error) {
          showMessage(error?.message || 'We could not send the link. Please try again.', true);
        } finally {
          submit.disabled = false;
        }
      });
    }
  } catch (error) {
    root.innerHTML = `<section style="max-width:460px;padding:28px;border-radius:20px;background:var(--surface,#fbf8f2)"><h1 style="font:500 30px Georgia,serif">Clay is not ready here yet</h1><p style="margin-top:12px" role="alert"></p></section>`;
    root.querySelector('[role="alert"]').textContent = error?.message || 'Please try again later.';
  }
}

void start();
