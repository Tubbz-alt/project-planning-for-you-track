import { authorizationFor, goToOauthPage, handlePotentialOauthRedirect } from '../main';
import MockLocation from '../mocks/mock-window-location';
import MockYouTrackOauth, { YOUTRACK_BASE_URL } from '../mocks/mock-you-track-oauth';

describe('handlePotentialOauthRedirect()', () => {
  const mockLocation: MockLocation = new MockLocation();

  beforeEach(() => {
    mockLocation.setup();
  });

  afterEach(() => {
    mockLocation.tearDown();
  });

  test('ignores redirect if session storage is empty', () => {
    window.location.href = 'http://localhost/fancy-web-app/';
    expect(handlePotentialOauthRedirect()).toBeUndefined();
  });

  test('ignores fake OAuth redirect', () => {
    window.location.href = 'http://localhost/fancy-web-app/#state=fake-state';
    expect(handlePotentialOauthRedirect()).toBeUndefined();
  });

  test('ignores OAuth redirect if parameters are missing', () => {
    window.location.href = 'http://localhost/fancy-web-app/';
    const appStateBeforeOauth = 'appState';
    goToOauthPage(YOUTRACK_BASE_URL, 'service-id', appStateBeforeOauth);
    const oAuthUrl = new URL(mockLocation.pastHrefChanges[mockLocation.pastHrefChanges.length - 1]);
    const stateParam: string = oAuthUrl.searchParams.get('state')!;
    window.location.href = `http://localhost/fancy-web-app/#state=${stateParam}&access_token=access-token`;
    expect(handlePotentialOauthRedirect()).toBeUndefined();
  });
});

describe('authorizationFor()', () => {
  const originalDateNow: () => number = global.Date.now;
  const mockYouTrackOauth = new MockYouTrackOauth();

  beforeAll(() => {
    // Freeze time temporarily. We do not constrain the number of times Date.now() may be called until we reset
    // Date.now (hence we don't use mockReturnValueOnce()).
    Date.now = jest.fn().mockReturnValue(10000);
    mockYouTrackOauth.setup();
    // Now advance time.
    Date.now = jest.fn().mockReturnValue(10000 + 60 * 60 * 1000);
  });

  afterAll(() => {
    mockYouTrackOauth.tearDown();
    global.Date.now = originalDateNow;
  });

  test('returns undefined if token expired', () => {
    expect(authorizationFor(YOUTRACK_BASE_URL)).toBeUndefined();
  });
});
