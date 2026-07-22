/**
 * Admin session token tests.
 *
 * These cover the part that decides who may write to the question bank,
 * so the cases that matter are the REJECTIONS: an unconfigured
 * deployment, a tampered signature, an expired token, and a token minted
 * under a different secret.
 */
import {
  checkAdminPassword, isAdminConfigured, issueAdminToken, verifyAdminToken,
} from '../src/lib/auth/adminToken';

const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

const NOW = 1_800_000_000_000;

async function run() {
  // --- fails shut when unconfigured ------------------------------------
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_SESSION_SECRET;

  check('unconfigured: reports not configured', !isAdminConfigured());
  check('unconfigured: cannot mint a token', (await issueAdminToken(NOW)) === null);
  check('unconfigured: rejects any password', !checkAdminPassword('anything'));
  check('unconfigured: rejects any token', !(await verifyAdminToken('1.abc', NOW)));

  // --- configured -------------------------------------------------------
  process.env.ADMIN_PASSWORD = 'correct-horse';

  check('configured: reports configured', isAdminConfigured());
  check('accepts the right password', checkAdminPassword('correct-horse'));
  check('rejects the wrong password', !checkAdminPassword('correct-hors'));
  check('rejects a password prefix', !checkAdminPassword('correct'));
  check('rejects an empty password', !checkAdminPassword(''));

  const token = await issueAdminToken(NOW);
  check('mints a token', typeof token === 'string' && token.includes('.'), token ?? 'null');
  check('accepts its own token', await verifyAdminToken(token, NOW));

  // --- rejections -------------------------------------------------------
  check('rejects an empty token', !(await verifyAdminToken('', NOW)));
  check('rejects undefined', !(await verifyAdminToken(undefined, NOW)));
  check('rejects a token with no signature', !(await verifyAdminToken('99999999999.', NOW)));
  check('rejects a non-numeric expiry', !(await verifyAdminToken('abc.sig', NOW)));

  const [exp, sig] = (token ?? '').split('.');
  check('rejects a tampered signature',
    !(await verifyAdminToken(`${exp}.${sig.slice(0, -1)}X`, NOW)));
  check('rejects an extended expiry (signature no longer covers it)',
    !(await verifyAdminToken(`${Number(exp) + 3600}.${sig}`, NOW)));

  // Expiry: valid one second before, dead one second after.
  const expiresAtMs = Number(exp) * 1000;
  check('valid just before expiry', await verifyAdminToken(token, expiresAtMs - 1000));
  check('rejected at expiry', !(await verifyAdminToken(token, expiresAtMs)));
  check('rejected after expiry', !(await verifyAdminToken(token, expiresAtMs + 1000)));

  // --- secret rotation --------------------------------------------------
  process.env.ADMIN_SESSION_SECRET = 'a-different-secret';
  check('rotating the secret invalidates old tokens', !(await verifyAdminToken(token, NOW)));

  const rotated = await issueAdminToken(NOW);
  check('new secret mints working tokens', await verifyAdminToken(rotated, NOW));

  delete process.env.ADMIN_SESSION_SECRET;
  check('reverting the secret revalidates the original', await verifyAdminToken(token, NOW));

  // --- report -----------------------------------------------------------
  let failed = 0;
  for (const [name, pass, note] of results) {
    if (!pass) failed++;
    console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${note ? `  (${note})` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exit(1);
}

void run();
