import * as RestApi from './you-track-rest';

const STORAGE_PREFIX = '@fschopp/you-track-planning-js';

const baseUrlToAccessTokenMap: {[baseUrl: string]: AccessToken} = {};

/**
 * A YouTrack base URL and application state for temporary storage in the session storage during an OAuth2 request.
 */
interface BaseUrlAndAppState<T> {
  baseUrl: string;
  appState: T;
}

/**
 * An access token, together with its type and validity period.
 */
interface AccessToken {
  type: string;
  secret: string;

  /**
   * Timestamp in milliseconds since the epoch.
   */
  validUntil: number;
}

/**
 * Returns the key in the session storage where the app state is stored temporarily (while the user is on the YouTrack
 * login page).
 */
function storageKeyForOauthId(oAuthId: string): string {
  return `${STORAGE_PREFIX}/oauth${oAuthId}`;
}

function normalizeUrl(baseUrl: string): string {
  return new URL(baseUrl).toString();
}

/**
 * Navigates the current window to the YouTrack OAuth2 page.
 *
 * Once successfully logged in, the YouTrack OAuth2 page will redirect the browser to the given `redirectUrl`. To be
 * able to seamlessly proceed where the user left off, the current application state needs to be preserved. This method
 * stores the given application state `appState` in the
 * [session storage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage). The rationale is:
 * 1. The application state could be larger than what one would reasonably encode in the redirect URL (which is another
 *    possibility of preserving the state).
 * 2. The application state does not leak to a third party.
 *
 * Nonetheless, users of this method should be aware of the limitations of using the session storage as well. MDN has
 * some [additional information](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API) on this topic.
 *
 * @typeparam T type of the application state
 * @param baseUrl The YouTrack base URL to which relative paths like `youtrack/api/...` or `hub/api/...` will be
 *     appended. The base URL is expected to and in a slash (/). See {@link YouTrackConfig.baseUrl}.
 * @param serviceId Identification of the particular YouTrack installation. See the
 *     [YouTrack manual](https://www.jetbrains.com/help/youtrack/standalone/OAuth-Authorization.html).
 * @param appState State that will be stored in session storage and later returned by
 *     {@link handlePotentialOauthRedirect}(). The value passed as argument needs to be serializable with
 *     {@link JSON.stringify}().
 * @param redirectUrl The URL that YouTrack will redirect back to after authorization. In order to not expose more data
 *     than necessary to the YouTrack server, the url will be stripped from its hash, username/password, and search
 *     query (if any). If state needs to be preserved, the `appState` argument should be used.
 */
export function goToOauthPage<T>(baseUrl: string, serviceId: string, appState: T,
    redirectUrl: string = window.location.href): void {
  const normalizedBaseUrl = normalizeUrl(baseUrl);
  const strippedRedirectUrl = new URL(redirectUrl);
  // Create a bare redirect URL, so to not expose more data than necessary
  strippedRedirectUrl.hash = '';
  strippedRedirectUrl.username = '';
  strippedRedirectUrl.password = '';
  strippedRedirectUrl.search = '';

  const oAuthId = `${Date.now().toString()}_${Math.floor(Math.random() * 10000)}`;
  const youTrackOauthUrl = new URL(RestApi.youTrackPath.OAUTH, normalizedBaseUrl);
  Object.entries({
    response_type: 'token',
    state: oAuthId,
    redirect_uri: strippedRedirectUrl.toString(),
    request_credentials: 'default',
    client_id: serviceId,
    scope: 'YouTrack',
  }).forEach(([key, value]) => youTrackOauthUrl.searchParams.append(key, value));

  const baseUrlAndAppState: BaseUrlAndAppState<T> = {
    baseUrl: normalizedBaseUrl,
    appState,
  };
  sessionStorage.setItem(storageKeyForOauthId(oAuthId), JSON.stringify(baseUrlAndAppState));
  window.location.href = youTrackOauthUrl.toString();
}

/**
 * Parses `window.location.href` to determine whether the URL stems from a YouTrack OAuth2 redirect, and returns the
 * restored application state if so.
 *
 * This method is meant to be called when the page is loaded. If the current URL contains a hash that is the result of
 * an OAuth2 redirect, any URL component except domain and path (such as search query or hash) will be removed. Note
 * that `window.location` will be updated with `window.history.replaceState()`.
 *
 * The application state will be restored from session storage. Unfortunately, some browsers are known to have bugs that
 * cause unexpected results if `sessionStorage` is accessed “too early,” relative to the page load in the browser. This
 * applies at least to [Safari 12.1.1](https://github.com/fschopp/project-planning-for-you-track/issues/1) and older
 * versions of [Firefox](https://stackoverflow.com/questions/13852209/localstorage-unreliable-in-firefox). (Recent
 * versions of Chrome and Firefox appear to work just fine.) It is advisable to delay calling this method (for instance,
 * with `setTimeout()`) when targeting browsers that are known to be problematic.
 *
 * Finally, this function keeps a record of the YouTrack authorization, making it available via
 * {@link authorizationFor}().
 *
 * @typeparam T type of the application state
 * @return object containing the application state or undefined if the current location is not the result of a YouTrack
 *     OAuth2 redirect
 */
export function handlePotentialOauthRedirect<T>(): T | undefined {
  const url = new URL(window.location.href);
  const fragmentParams = new URLSearchParams(url.hash.slice(1));
  const oAuthId: string | null = fragmentParams.get('state');
  if (oAuthId !== null) {
    const key = storageKeyForOauthId(oAuthId);
    const storedValue: string | null = sessionStorage.getItem(key);
    if (storedValue !== null) {
      const baseUrlAndAppState: BaseUrlAndAppState<T> = JSON.parse(storedValue);
      sessionStorage.removeItem(key);

      const secret: string | null = fragmentParams.get('access_token');
      const expiresIn: string | null = fragmentParams.get('expires_in');
      const type: string | null = fragmentParams.get('token_type');
      if (secret !== null && expiresIn !== null && type !== null) {
        const validUntil: number = Date.now() + parseInt(expiresIn, 10) * 1000;
        baseUrlToAccessTokenMap[baseUrlAndAppState.baseUrl] = {
          type,
          secret,
          validUntil,
        };
        url.hash = '';
        // Not using window.location.replace(), because that triggers page reloads when passing more than just a
        // (relative URL with a) hash.
        window.history.replaceState(undefined, '', url.toString());
        return baseUrlAndAppState.appState;
      }
    }
  }
  return undefined;
}

/**
 * Returns the access token for the given base URL, or undefined if there is no (unexpired) one.
 *
 * This method returns the HTTP Authorization header known due to a previous call to
 * {@link handlePotentialOauthRedirect}(), or undefined if not known for the given URL.
 *
 * @param baseUrl The YouTrack base URL to which relative paths like `youtrack/api/...` or `hub/api/...` will be
 *     appended. The base URL is expected to end in a slash (/). See {@link httpGet}().
 * @return value for HTTP authorization header
 */
export function authorizationFor(baseUrl: string): string | undefined {
  const normalizedBaseUrl = normalizeUrl(baseUrl);
  if (!(normalizedBaseUrl in baseUrlToAccessTokenMap)) {
    return undefined;
  }

  const accessToken: AccessToken = baseUrlToAccessTokenMap[normalizedBaseUrl];
  if (Date.now() >= accessToken.validUntil) {
    delete baseUrlToAccessTokenMap[normalizedBaseUrl];
    return undefined;
  }

  return `${accessToken.type} ${accessToken.secret}`;
}
