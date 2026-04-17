export const config = { runtime: 'edge' };

const GOOGLE_KEY = process.env.GOOGLE_STREETVIEW_KEY ?? '';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const { searchParams } = new URL(req.url);
  const mode    = searchParams.get('mode') ?? 'image';
  const lat     = searchParams.get('lat');
  const lng     = searchParams.get('lng');
  const heading = searchParams.get('heading') ?? '0';
  const pitch   = searchParams.get('pitch')   ?? '0';
  const fov     = searchParams.get('fov')     ?? '90';
  const size    = searchParams.get('size')    ?? '640x360';

  if (!lat || !lng) {
    return new Response('lat and lng required', { status: 400 });
  }

  if (mode === 'metadata') {
    const url = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('key', GOOGLE_KEY);

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
  imgUrl.searchParams.set('key',     GOOGLE_KEY);

  const res  = await fetch(imgUrl.toString());
  const body = await res.arrayBuffer();

  const headers = {
    'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
    'Cache-Control': 'public, max-age=86400',
  };
  // Google returns a ~5 KB grey placeholder for no-coverage locations
  if (body.byteLength < 6000) headers['X-No-Coverage'] = '1';

  return new Response(body, { status: res.status, headers });
}
