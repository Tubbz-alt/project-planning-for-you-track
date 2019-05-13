import { Failure, httpGet, isFailure } from '../main';
import { YouTrackError } from '../main/you-track-rest';
import MockXmlHttpRequest from '../mocks/mock-xml-http-request';
import MockYouTrackOauth, { YOUTRACK_BASE_URL } from '../mocks/mock-you-track-oauth';

test('httpGet() fails without authorization', async () => {
  let failure: Failure | undefined;
  try {
    await httpGet<{id: string}[]>('http://unknown/', 'some/path');
  } catch (exception) {
    expect(isFailure(exception)).toBeTruthy();
    failure = exception;
  }
  expect(failure).toContain('No valid unexpired OAuth token available for http://unknown/.');
});

describe('httpGet() when authorized', () => {
  const mockYouTrackOauth = new MockYouTrackOauth();

  beforeAll(() => {
    mockYouTrackOauth.setup();
    MockXmlHttpRequest.setup();
  });

  afterAll(() => {
    MockXmlHttpRequest.tearDown();
    mockYouTrackOauth.tearDown();
  });

  test('rejects on no response', async () => {
    MockXmlHttpRequest.responseForRequest = (ignoredUrl: URL) => [null, 0];
    let failure: Failure | undefined;
    const url = new URL('some/path', YOUTRACK_BASE_URL);
    try {
      await httpGet<{id: string}[]>(YOUTRACK_BASE_URL, 'some/path');
    } catch (exception) {
      expect(isFailure(exception)).toBeTruthy();
      failure = exception;
    }
    expect(failure).toBe(
        `The YouTrack server could not be reached (URL: ${url}). Please check your network connection.`);
  });

  test('rejects on YouTrackError', async () => {
    const youTrackError: YouTrackError = {
      error: 'Not Found',
      error_description: 'Entity with id unknown-id not found',
    };
    MockXmlHttpRequest.responseForRequest = (ignoredUrl: URL) => [youTrackError, 404];
    let failure: Failure | undefined;
    const url = new URL('some/path', YOUTRACK_BASE_URL);
    try {
      await httpGet<{id: string}[]>(YOUTRACK_BASE_URL, 'some/path');
    } catch (exception) {
      expect(isFailure(exception)).toBeTruthy();
      failure = exception;
    }
    expect(failure).toBe(
        `The YouTrack server returned the following error (URL: ${url}): ${youTrackError.error_description}`);
  });

  test('rejects on unknown error', async () => {
    MockXmlHttpRequest.responseForRequest = (ignoredUrl: URL) => ['unknown', 418];
    let failure: Failure | undefined;
    const url = new URL('some/path', YOUTRACK_BASE_URL);
    try {
      await httpGet<{id: string}[]>(YOUTRACK_BASE_URL, 'some/path');
    } catch (exception) {
      expect(isFailure(exception)).toBeTruthy();
      failure = exception;
    }
    expect(failure).toBe(`The YouTrack server returned an unexpected error (URL: ${url}, HTTP status: 418).`);
  });
});
