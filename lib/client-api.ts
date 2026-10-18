/**
 * Browser-side helpers for calling the app's API routes. They throw `ApiError` for failed
 * requests, so callers have a single `catch` that turns any failure into a message.
 */

/** A failed API call: network error, non-2xx response, or a response we couldn't use. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A readable message for anything caught from an API call. */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Options {
  /** On 401, go to the login page (default). Turn off for the login form itself. */
  redirectOn401?: boolean;
}

/** POST a JSON body. Resolves with the response when it's 2xx; otherwise throws `ApiError`. */
export async function post(url: string, body: unknown, { redirectOn401 = true }: Options = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(`Can't reach the server: ${errorText(e)}`);
  }
  if (res.ok) return res;

  if (res.status === 401 && redirectOn401) {
    // Session expired or logged out in another tab.
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  const data: { error?: string } = await res.json().catch(() => ({}));
  throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
}

/** POST a JSON body and parse the JSON response. Throws `ApiError` on failure. */
export async function postJson<T>(url: string, body: unknown, options?: Options): Promise<T> {
  const res = await post(url, body, options);
  return (await res.json().catch(() => {
    throw new ApiError("The server sent an invalid response.", res.status);
  })) as T;
}
