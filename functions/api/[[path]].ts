export interface Env {
  BACKEND_URL?: string;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export async function onRequest(context: PagesFunction<Env>): Promise<Response> {
  const backendUrl = context.env.BACKEND_URL?.trim();
  if (!backendUrl) {
    return new Response("Missing BACKEND_URL environment variable.", { status: 500 });
  }

  const requestUrl = new URL(context.request.url);
  const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, normalizeBaseUrl(backendUrl));

  const headers = new Headers(context.request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));

  const init: RequestInit = {
    method: context.request.method,
    headers,
    redirect: "follow",
  };

  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    init.body = await context.request.arrayBuffer();
  }

  const upstreamResponse = await fetch(upstreamUrl.toString(), init);
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.set("access-control-allow-origin", "*");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
