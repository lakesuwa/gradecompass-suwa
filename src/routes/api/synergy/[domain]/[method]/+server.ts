import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const prerender = false;

// The JSON API sends no CORS headers, so the browser cannot call it directly.
export const POST: RequestHandler = async ({ params, request }) => {
	const { domain, method } = params;

	if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) error(400, 'Invalid domain');
	if (!/^[A-Za-z]+$/.test(method)) error(400, 'Invalid method');

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'User-Agent': 'ksoap',
		AppNameOSAndVersion: 'StudentVUE|Android|1.9.16'
	};
	const authorization = request.headers.get('Authorization');
	if (authorization) headers.Authorization = authorization;

	const upstream = await fetch(`https://${domain}/api/v1/mobile/PXPWebServices/${method}`, {
		method: 'POST',
		headers,
		body: await request.text()
	});

	return new Response(await upstream.text(), {
		status: upstream.status,
		headers: { 'Content-Type': 'application/json' }
	});
};
