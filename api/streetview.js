export const config = { runtime: 'edge' };

const GOOGLE_KEY   = process.env.GOOGLE_STREETVIEW_KEY ?? '';
const SB_URL       = 'https://yobvrleuwmchsxkpcshv.supabase.co';
const SB_ANON      = 'sb_publishable_tOLuYgic96IH1vg9QHLfVw_BV1hPMAv';

async function resolveKey(userToken) {
  const headers = { 'apikey': SB_ANON, 'Authorization': `Bearer ${userToken}` };

  // 1. User's own BYOK key stored in user_google_keys
  const kr = await fetch(`${SB_URL}/rest/v1/user_google_keys?select=streetview_key&limit=1`, { headers });
  if (kr.ok) {
    const rows = await kr.json();
    if (rows?.[0]?.streetview_key) return rows[0].streetview_key;
  }

  // 2. Internal team override (Bart's own accounts, no Stripe required)
  const ir = await fetch(`${SB_URL}/rest/v1/rpc/get_my_internal_access`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (ir.ok) {
    const rows = await ir.json();
    if (rows?.[0]?.pro_override) return GOOGLE_KEY;
  }

  // 3. Active Pro subscription — Bart's site key used, cost covered by subscription revenue
  const pr = await fetch(`${SB_URL}/rest/v1/user_entitlements?select=plan,subscription_status&limit=1`, { headers });
  if (pr.ok) {
    const rows = await pr.json();
    const e = rows?.[0];
    if (e?.plan === 'pro' && e?.subscription_status === 'active') return GOOGLE_KEY;
  }

  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth  = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  const apiKey = token ? await resolveKey(token) : null;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'street_view_access_required' }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { searchParams } = new URL(req.url);
  const mode    = searchParams.get('mode') ?? 'image';
  const lat     = searchParams.get('lat');
  const lng     = searchParams.get('lng');
  const heading = searchParams.get('heading') ?? '0';
  const pitch   = searchParams.get('pitch')   ?? '0';
  const fov     = searchParams.get('fov')     ?? '90';
  const size    = searchParams.get('size')    ?? '640x360';

  if (!lat || !lng) return new Response('lat and lng required', { status: 400 });

  if (mode === 'metadata') {
    const url = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('key', apiKey);
    const res  = await fetch(url.toString());
    const json = await res.json();
    const headers = { 'Content-Type': 'application/json' };
    if (json.status !== 'OK') headers['X-No-Coverage'] = '1';
    return new Response(JSON.stringify(json), { status: 200, headers });
  }

  // mode === 'image'
  const imgUrl = new URL('https://maps.googleapis.com/maps/api/streetview');
  imgUrl.searchParams.set('location', `${lat},${lng}`);
  imgUrl.searchParams.set('heading', heading);
  imgUrl.searchParams.set('pitch',   pitch);
  imgUrl.searchParams.set('fov',     fov);
  imgUrl.searchParams.set('size',    size);
  imgUrl.searchParams.set('key',     apiKey);

  const res  = await fetch(imgUrl.toString());
  const body = await res.arrayBuffer();
  const headers = {
    'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
    'Cache-Control': 'public, max-age=86400',
  };
  if (body.byteLength < 6000) headers['X-No-Coverage'] = '1';
  return new Response(body, { status: res.status, headers });
}
