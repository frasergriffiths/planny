import { waitUntil } from '@vercel/functions';
import { clientAddress, sendResponse, toRequest } from '../src/http.js';
import { createVercelApp } from '../src/vercel.js';

// Every request is rewritten here by vercel.json. Vercel's forwarded address is trusted only
// on Vercel, where it is set by the platform.
let app;

export default async function handler(req, res) {
  try {
    app ??= createVercelApp({ waitUntil });
    const response = await app.handle(toRequest(req, 'https'), {
      address: clientAddress(req, { forwarded: true }),
    });
    await sendResponse(res, response, req.method);
  } catch (error) {
    console.error('planny: could not answer a request', error.message);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(`${JSON.stringify({ error: { code: 'server_error', message: 'planny could not answer. Try again in a minute.' } })}\n`);
  }
}
