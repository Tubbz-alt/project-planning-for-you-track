declare global {
  namespace NodeJS {
    interface Global {
      XMLHttpRequest?: new() => object;
    }
  }
}

/**
 * Mock for {@link XMLHttpRequest}.
 */
export default class MockXmlHttpRequest {
  public static responseForRequest?: (url: URL) => [any, number];
  private static originalXmlHttpRequest_: typeof global.XMLHttpRequest;

  public onloadend: ((this: MockXmlHttpRequest) => any) | null = null;
  public status: number = 200;
  public response: any;

  private url_?: URL;

  public open(method: string, url: string): void {
    expect(method).toBe('GET');
    this.url_ = new URL(url);
  }

  public setRequestHeader(ignoredHeaderName: string, ignoredHeaderValue: string): void { /* no-op */ }

  public send(): void {
    expect(MockXmlHttpRequest.responseForRequest).toBeDefined();
    expect(this.url_).toBeDefined();
    const [response, status] = MockXmlHttpRequest.responseForRequest!(this.url_!);
    this.response = response;
    this.status = status;
    expect(this.response).toBeDefined();
    expect(this.onloadend).toBeDefined();
    this.onloadend!();
  }

  public static setup(): void {
    MockXmlHttpRequest.originalXmlHttpRequest_ = global.XMLHttpRequest;

    global.XMLHttpRequest = MockXmlHttpRequest;
  }

  public static tearDown() {
    global.XMLHttpRequest = MockXmlHttpRequest.originalXmlHttpRequest_;
    MockXmlHttpRequest.responseForRequest = undefined;
  }
}
