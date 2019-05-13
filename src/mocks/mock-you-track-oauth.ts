import { goToOauthPage, handlePotentialOauthRedirect } from '../main';
import MockLocation from './mock-window-location';

export const YOUTRACK_BASE_URL = 'http://youtrack/';

export default class MockYouTrackOauth {
  private mockLocation: MockLocation = new MockLocation();

  public setup(): void {
    this.mockLocation.setup();
    const currentURL = new URL('http://localhost/fancy-web-app/');
    const appStateBeforeOauth = 'appState';
    goToOauthPage(YOUTRACK_BASE_URL, 'service-id', appStateBeforeOauth, currentURL.toString());
    expect(this.mockLocation.pastHrefChanges.length).toBe(1);
    const oAuthUrl = new URL(this.mockLocation.pastHrefChanges[0]);
    const hashParams = new URLSearchParams();
    hashParams.set('access_token', 'access-token');
    hashParams.set('expires_in', '3600');
    hashParams.set('token_type', 'Bearer');
    const stateParam: string | null = oAuthUrl.searchParams.get('state');
    expect(stateParam).not.toBeNull();
    hashParams.set('state', stateParam!);
    currentURL.hash = hashParams.toString();
    window.location.href = currentURL.toString();
    const appState: string | undefined = handlePotentialOauthRedirect<string>();
    expect(appState).toBe(appStateBeforeOauth);
  }

  public tearDown(): void {
    this.mockLocation.tearDown();
  }
}
