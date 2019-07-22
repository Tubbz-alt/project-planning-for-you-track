import { Failure } from './api-types';
import { authorizationFor } from './you-track-oauth';
import { YouTrackError } from './you-track-rest';

function isYouTrackError<T>(value: any): value is YouTrackError {
  // noinspection SuspiciousTypeOfGuard
  return value && typeof value.error === 'string' && typeof value.error_description === 'string';
}

/**
 * Returns a promise that will be fulfilled with the result of an HTTP GET request to a YouTrack REST resource.
 *
 * This method sets the HTTP Authorization header if it is known due to a previous call to
 * {@link handlePotentialOauthRedirect}(). If no authorization is available, this method rejects the promise
 * immediately.
 *
 * @typeparam T the type of the response by YouTrack (after parsing the JSON)
 * @param baseUrl The YouTrack base URL to which relative paths of form `api/...` will be appended. The base URL is
 *     expected to end in a slash (/). For an InCloud instance without a custom domain, this is of form
 *     `https://<name>.myjetbrains.com/youtrack/`.
 * @param resourcePath relative path to the REST API resource requested
 * @param queryParams parameters that will be added to the query string
 * @return A promise that in case of success will be fulfilled with the retrieved object. In case of any failure, it
 *     will be rejected with a {@link Failure}.
 */
export function httpGet<T>(baseUrl: string, resourcePath: string, queryParams: {[param: string]: string} = {}):
    Promise<T> {
  const authorization: string | undefined = authorizationFor(baseUrl);
  if (authorization === undefined) {
    const failure: Failure = `No valid unexpired OAuth token available for ${baseUrl}.`;
    return Promise.reject(failure);
  }

  const url = new URL(resourcePath, baseUrl);
  const urlSearchParams = url.searchParams;
  Object.entries(queryParams).forEach(([key, value]) => urlSearchParams.append(key, value));
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url.toString());
  xhr.setRequestHeader('Authorization', authorization);
  xhr.setRequestHeader('Accept', 'application/json');
  xhr.responseType = 'json';
  const promise = new Promise<T>((resolve, reject) => {
    xhr.onloadend = () => onRequestFinished<T>(url, xhr, resolve, reject);
  });
  xhr.send();
  return promise;
}

/**
 * Returns a promise that will be fulfilled with the result of an HTTP GET request to a YouTrack REST array resource.
 *
 * This method sets the HTTP Authorization header if it is known due to a previous call to
 * {@link handlePotentialOauthRedirect}(). If no authorization is available, this method rejects the promise
 * immediately.
 *
 * @typeparam T the element type of the array response by YouTrack (after parsing the JSON)
 * @param baseUrl The YouTrack base URL. See also {@link httpGet}().
 * @param resourcePath relative path to the REST API resource requested
 * @param queryParams parameters that will be added to the query string
 * @param restBatchSize Number of elements per HTTP request. Larger values are faster, but increase the risk of
 *     transmission problems (or outright rejection by future YouTrack versions that may have rate limitations).
 * @return A promise that in case of success will be fulfilled with the retrieved array. In case of any failure, it
 *     will be rejected with a {@link Failure}.
 */
export async function httpGetAll<T>(baseUrl: string, resourcePath: string,
    queryParams: {[param: string]: string}, restBatchSize: number): Promise<T[]> {
  return httpGetAllWithOptions<T, T[]>(baseUrl, resourcePath, queryParams, restBatchSize, (batch, array) => {
    array.push(...batch);
    return array;
  }, []);
}

/**
 * Returns a promise that will be fulfilled with a transformation of the result of an HTTP GET request to a YouTrack
 * REST array resource.
 *
 * This method sets the HTTP Authorization header if it is known due to a previous call to
 * {@link handlePotentialOauthRedirect}(). If no authorization is available, this method rejects the promise
 * immediately.
 *
 * @typeparam T the element type of the array response by YouTrack (after parsing the JSON)
 * @typeparam U the return type of `processBatch()` and therefore also this function
 * @param baseUrl The YouTrack base URL. See also {@link httpGet}().
 * @param resourcePath relative path to the REST API resource requested
 * @param queryParams parameters that will be added to the query string
 * @param restBatchSize Number of elements per HTTP request. See also {@link httpGetAll}().
 * @param processBatch callback called for the result of each individual HTTP request
 * @param processBatch.batch the retrieved array
 * @param processBatch.previous the state returned by the previous invocation of `processBatch()`, or the value of
 *     `initial` if this is the first invocation
 * @param initial the value passed to the first invocation of `processBatch()` as argument `initial`
 * @return A promise that in case of success will be fulfilled with the last result of `processBatch()`. In case of any
 *     failure, it will be rejected with a {@link Failure}.
 */
export async function httpGetAllWithOptions<T, U>(baseUrl: string, resourcePath: string,
    queryParams: {[param: string]: string}, restBatchSize: number,
    processBatch: (batch: T[], previous: U) => U, initial: U): Promise<U> {
  let numElementsRetrieved: number = 0;
  let busy = true;
  queryParams.$top = restBatchSize.toString();
  let batchPromise: Promise<T[]> = httpGet<T[]>(baseUrl, resourcePath, queryParams);
  let state: U = initial;
  do {
    const batch: T[] = await batchPromise;
    numElementsRetrieved += batch.length;
    if (batch.length >= restBatchSize) {
      queryParams.$skip = numElementsRetrieved.toString();
      batchPromise = httpGet<T[]>(baseUrl, resourcePath, queryParams);
    } else {
      busy = false;
    }
    state = processBatch(batch, state);
  } while (busy);
  return state;
}

/**
 * Handles completion of an {@link XMLHttpRequest}, whether successful or not.
 */
function onRequestFinished<T>(url: URL, xhr: XMLHttpRequest, resolve: (result: T) => void,
    reject: (failure: Failure) => void): void {
  // From https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/response:
  // "The value is null if the request is not yet complete or was unsuccessful"
  const response: T | YouTrackError | null = xhr.response;
  let failure: Failure;
  if (response === null) {
    failure =
        `The YouTrack server could not be reached (URL: ${url}). Please check your network connection.`;
  } else if (isYouTrackError(response)) {
    failure =
        `The YouTrack server returned the following error (URL: ${url}): ${response.error_description}`;
  } else if (xhr.status === 200) {
    resolve(response);
    return;
  } else {
    failure = `The YouTrack server returned an unexpected error (URL: ${url}, HTTP status: ${xhr.status}).`;
  }
  reject(failure);
}
