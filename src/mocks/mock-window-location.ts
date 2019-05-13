export default class MockLocation {
  public pastHrefChanges: string[] = [];

  private originalDescriptor_: PropertyDescriptor | undefined;

  get href(): string {
    expect(this.pastHrefChanges.length).toBeGreaterThan(0);
    return this.pastHrefChanges[this.pastHrefChanges.length - 1];
  }

  set href(url: string) {
    this.pastHrefChanges.push(url);
  }

  public setup(): void {
    this.pastHrefChanges = [];
    this.originalDescriptor_ = Object.getOwnPropertyDescriptor(window, 'location')!;
    expect(this.originalDescriptor_).toBeDefined();
    Object.defineProperties(window, {
      location: {
        configurable: true,
        value: this,
      },
    });
  }

  public tearDown() {
    expect(this.originalDescriptor_).toBeDefined();
    Object.defineProperties(window, {
      location: this.originalDescriptor_!,
    });
  }
}
