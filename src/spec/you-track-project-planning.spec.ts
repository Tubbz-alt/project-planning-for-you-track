import {
  getMinutesPerWorkWeek,
  ProgressCallback,
  ProjectPlan,
  reconstructProjectPlan,
  YouTrackConfig,
  YouTrackIssue,
} from '../main';
import MockXmlHttpRequest from '../mocks/mock-xml-http-request';
import MockYouTrackOauth, { YOUTRACK_BASE_URL } from '../mocks/mock-you-track-oauth';
import YouTrackDatabase, {
  CUSTOM_FIELD_ID_TYPE,
  ISSUE_READABLE_ID,
  ISSUE_SUMMARY,
  STATE_BUNDLE_ELEMENT_ID,
  YouTrackData,
} from '../mocks/you-track-database';

const originalDateNow: () => number = global.Date.now;
const mockYouTrackOauth = new MockYouTrackOauth();
// Mock data that is shared by tests in this file
const ACTIVITY_DEFAULTS = {
  assignee: '',
  end: Number.MAX_SAFE_INTEGER,
  isWaiting: false,
};

beforeAll(() => {
  mockYouTrackOauth.setup();
  MockXmlHttpRequest.setup();
});

afterAll(() => {
  MockXmlHttpRequest.tearDown();
  mockYouTrackOauth.tearDown();
  global.Date.now = originalDateNow;
});

// This cannot be a constant, because then some properties are not primitives (which could confuse deep-equals
// algorithms, because of shared objects).
function issueDefaults(index: number) {
  return {
    id: ISSUE_READABLE_ID(index),
    summary: ISSUE_SUMMARY(index),
    remainingEffortMs: 0,
    remainingWaitTimeMs: 0,
    splittable: false,
    dependencies: [],
    assignee: '',
    issueActivities: [],
    resolved: Number.MAX_SAFE_INTEGER,
    state: '',
    parent: '',
    customFields: {[CUSTOM_FIELD_ID_TYPE]: ''},
  };
}

function reconstructProjectPlanWithData(youTrackData: YouTrackData): Promise<ProjectPlan> {
  const youTrackDatabase: YouTrackDatabase = new YouTrackDatabase(youTrackData);
  MockXmlHttpRequest.responseForRequest = (url: URL) => youTrackDatabase.responseForRequest(url);
  return reconstructProjectPlan(YOUTRACK_BASE_URL, youTrackDatabase.youTrackConfig(),
      () => { /* nothing */});
}

describe('reconstructProjectPlan() handles edge cases', () => {
  test('no issues in saved search', async () => {
    const projectPlan: ProjectPlan = await reconstructProjectPlanWithData({issues: []});
    const expected: ProjectPlan = {
      issues: [],
      warnings: [],
    };
    expect(projectPlan).toEqual(expected);
  });

  test('interprets unknown as active if this is the last state transition', async () => {
    const youTrackData: YouTrackData = {
      issues: [{states: [[0, 'in progress'], [10, '*unknown']]}],
    };
    const projectPlan: ProjectPlan = await reconstructProjectPlanWithData(youTrackData);
    const expected: ProjectPlan = {
      issues: [{
        ...issueDefaults(0),
        // Explanation: The last state is unknown, which is treated as active. Hence, there is only one open-ended
        // activity.
        issueActivities: [{...ACTIVITY_DEFAULTS, start: 0}],
        state: '',
      }],
      warnings: [],
    };
    expect(projectPlan).toEqual(expected);
  });

  test('removes short active phase also if state transition sequence ends with it', async () => {
    const youTrackData: YouTrackData = {
      coalesceBelowMs: 3,
      resolvedStates: ['done'],
      inactiveUnresolvedStates: ['open'],
      issues: [{states: [[0, 'open'], [1, 'in progress'], [2, 'done']]}],
    };
    const projectPlan: ProjectPlan = await reconstructProjectPlanWithData(youTrackData);
    const expected: ProjectPlan = {
      issues: [{
        ...issueDefaults(0),
        issueActivities: [],
        resolved: 2,
        state: STATE_BUNDLE_ELEMENT_ID('done'),
      }],
      warnings: [],
    };
    expect(projectPlan).toEqual(expected);
  });
});

describe('reconstructProjectPlan() produces warnings', () => {
  test('missing parent, missing dependency, missing subissue', async () => {
    const youTrackData: YouTrackData = {
      issues: [{par: 1, dep: [2], unknownSubissues: [3], states: [[1, 'in progress']]}],
    };
    const projectPlan: ProjectPlan = await reconstructProjectPlanWithData(youTrackData);
    const expected: ProjectPlan = {
      issues: [{
        ...issueDefaults(0),
        issueActivities: [{...ACTIVITY_DEFAULTS, start: 1}],
        state: STATE_BUNDLE_ELEMENT_ID('in progress'),
      }],
      warnings: [{
        description: 'Issue XYZ-0 is a subtask of XYZ-1, which is not contained in saved search “Saved Search: Base”.',
        issueId: 'XYZ-0',
      }, {
        description: 'Issue XYZ-0 depends on XYZ-2, which is/are not contained in saved search “Saved Search: Base”.',
        issueId: 'XYZ-0',
      }, {
        description:
            'Issue XYZ-0 is a parent for XYZ-3, which is/are not contained in saved search “Saved Search: Base”.',
        issueId: 'XYZ-0',
      }],
    };
    expect(projectPlan).toEqual(expected);
  });
});

describe('reconstructProjectPlan()', () => {
  const youTrackData: YouTrackData = {
    coalesceBelowMs: 3,
    inactiveUnresolvedStates: ['open'],
    resolvedStates: ['duplicate', 'closed', 'done'],
    issues: [
      // Property 'states' is an array of state changes. Each state change is a 2- or 3-element array. The optional 3rd
      // element overrides what will be reported as previous state in the YouTrack activities pages (the default is
      // simply whatever the previous state-change element said).
      {type: 'epic', states: [[0, '*submitted'], [3, '*open'], [5, 'duplicate'], [8, 'in progress'], [12, 'done']],
          assignee: 'user-1'},
      {type: 'issue', states: [[2, '*submitted'], [5, 'closed']], par: 0, dep: [2], effort: 2, wait: 1},
      {type: 'bug', states: [[3, 'open'], [8, 'in progress'], [9, 'under review'], [10, 'closed'], [11, 'under review'],
          [12, 'closed']], par: 0},
      {type: 'bug', states: [[5, 'duplicate']]},
      {type: 'issue', states: [[0, 'open'], [1, 'in progress'], [2, 'done'], [3, ''], [4, 'done', 'in progress']],
          par: 5, effort: 2, wait: 2},
      {type: 'bug', states: [[7, '*open'], [8, '*in progress'], [9, 'open'], [12, '*in progress']], effort: 3, wait: 1},
    ],
  };
  const expectedYouTrackIssues: YouTrackIssue[] = [
    // Explanation for periods: '*open' can be matched to 'open', hence that's where the issue becomes inactive.
    {...issueDefaults(0), state: STATE_BUNDLE_ELEMENT_ID('done'),
        issueActivities: [{...ACTIVITY_DEFAULTS, assignee: 'user-1', start: 0, end: 3},
            {...ACTIVITY_DEFAULTS, assignee: 'user-1', start: 8, end: 12}],
        resolved: 12, customFields: {[CUSTOM_FIELD_ID_TYPE]: 'epic'}, assignee: 'user-1'},

    // Explanation for remainingEffortMs and remainingWaitMs: Should be 0 because issue is resolved
    {...issueDefaults(1), state: STATE_BUNDLE_ELEMENT_ID('closed'),
        issueActivities: [{...ACTIVITY_DEFAULTS, start: 2, end: 5}], parent: ISSUE_READABLE_ID(0),
        dependencies: [ISSUE_READABLE_ID(2)], resolved: 5, customFields: {[CUSTOM_FIELD_ID_TYPE]: 'issue'}},

    // Explanation for issueActivities: while the issue is inactive between 5 and 7, the inactive interval has duration
    // less than 3, so it is removed.
    {...issueDefaults(2), state: STATE_BUNDLE_ELEMENT_ID('closed'),
        issueActivities: [{...ACTIVITY_DEFAULTS, start: 8, end: 12}], parent: ISSUE_READABLE_ID(0), resolved: 12,
        customFields: {[CUSTOM_FIELD_ID_TYPE]: 'bug'}},

    {...issueDefaults(3), state: STATE_BUNDLE_ELEMENT_ID('duplicate'), resolved: 5,
        customFields: {[CUSTOM_FIELD_ID_TYPE]: 'bug'}},

    // Again, the issue is closed, so remainingEffortMs and remainingWaitTimeMs are 0. Nonetheless, the remaining effort
    // in the issue tracker does nonetheless count towards the parent. See below.
    {...issueDefaults(4), state: STATE_BUNDLE_ELEMENT_ID('done'),
        issueActivities: [{...ACTIVITY_DEFAULTS, start: 1, end: 4}], resolved: 4, parent: ISSUE_READABLE_ID(5),
        customFields: {[CUSTOM_FIELD_ID_TYPE]: 'issue'}},

    // Explanation for issueActivities: while the issue is active between 8 and 9, this interval has duration less
    // than 3. Additionally, the next active interval begins only 3 timesteps later, so the active intervals are not
    // merged.
    {...issueDefaults(5), state: '',
        issueActivities: [{...ACTIVITY_DEFAULTS, start: 12}], customFields: {[CUSTOM_FIELD_ID_TYPE]: 'bug'},
        remainingEffortMs: (3 - 2) * 60 * 1000, remainingWaitTimeMs: 60 * 1000},
  ];
  const youTrackDatabase: YouTrackDatabase = new YouTrackDatabase(youTrackData);

  beforeAll(() => {
    MockXmlHttpRequest.responseForRequest = (url: URL) => youTrackDatabase.responseForRequest(url);
  });

  afterEach(() => {
    // Reset to the default.
    youTrackDatabase.sideOfDependsOn = 'INWARD';
  });

  async function runComputation(initialTime: number, configOverride?: Partial<YouTrackConfig>,
      progressUpdateIntervalMs?: number, restBatchSize?: number): Promise<ProjectPlan> {
    let previousPercentageDone = -1;
    const progressCallback: ProgressCallback = (percentageDone) => {
      expect(percentageDone).toBeGreaterThanOrEqual(0);
      expect(percentageDone).toBeLessThanOrEqual(100);
      expect(percentageDone).toBeGreaterThanOrEqual(previousPercentageDone);
      previousPercentageDone = percentageDone;
    };

    const youTrackConfig: YouTrackConfig = {...youTrackDatabase.youTrackConfig(), ...configOverride};
    let currentTime = initialTime;
    Date.now = jest.fn().mockImplementation(() => currentTime++);
    const projectPlan = await reconstructProjectPlan(YOUTRACK_BASE_URL, youTrackConfig, progressCallback,
        progressUpdateIntervalMs, restBatchSize);
    if (progressUpdateIntervalMs !== undefined) {
      if (progressUpdateIntervalMs > 100) {
        expect(previousPercentageDone).toBe(-1);
      } else if (progressUpdateIntervalMs === 1) {
        expect(previousPercentageDone).toBe(100);
      }
    }
    return projectPlan;
  }

  test('works without no overlay saved search', async () => {
    await expect(runComputation(14, {overlaySavedQueryId: ''}, 1, 2)).resolves.toEqual({
      issues: expectedYouTrackIssues,
      warnings: [],
    } as ProjectPlan);
  });

  test('works with overlay saved search', async () => {
    await expect(runComputation(14)).resolves.toEqual({
      issues: [
        expectedYouTrackIssues[4],
        expectedYouTrackIssues[1],
        expectedYouTrackIssues[2],
        expectedYouTrackIssues[3],
        expectedYouTrackIssues[0],
        expectedYouTrackIssues[5],
      ],
      warnings: [],
    } as ProjectPlan);
  });

  test('works with reversed direction of finish-to-start links in YouTrack', async () => {
    youTrackDatabase.sideOfDependsOn = 'OUTWARD';
    await expect(runComputation(14, {overlaySavedQueryId: ''})).resolves.toEqual({
      issues: expectedYouTrackIssues,
      warnings: [],
    } as ProjectPlan);
  });
});

test('getMinutesPerWorkWeek()', async () => {
  await expect(getMinutesPerWorkWeek(YOUTRACK_BASE_URL)).resolves.toEqual(5 * 8 * 60);
});
