import * as ProjectPlanningJs from '@fschopp/project-planning-js';
import {
  appendSchedule,
  Failure,
  groupByIntervalAndWaitStatus,
  IssueActivity,
  MultiAssigneeIssueActivity,
  ProjectPlan,
  SchedulableIssue,
  Schedule,
  scheduleUnresolved,
  SchedulingOptions,
} from '../main';
import { deepClone } from '../main/util';

const MINUTES_PER_WEEK = 7 * 24 * 60;

// We mock module ProjectPlanningJs because computeScheduleAsync relies on web workers. It is unnecessary (and avoids a
// more complicated setup) if we just mock computeScheduleAsync function to execute synchronously.
//
// Note that all of this works because the mock is hoisted to the top of the file!
// https://jestjs.io/docs/en/es6-class-mocks
type ProjectPlanningJs = typeof ProjectPlanningJs;
jest.mock('@fschopp/project-planning-js', (): Partial<ProjectPlanningJs> => {
  const actualModule: ProjectPlanningJs = jest.requireActual('@fschopp/project-planning-js');

  function computeScheduleAsync(...args: Parameters<typeof actualModule.computeSchedule>):
      ReturnType<typeof actualModule.computeScheduleAsync> {
    const result: ProjectPlanningJs.Schedule | ProjectPlanningJs.SchedulingFailure =
        actualModule.computeSchedule(...args);
    return actualModule.isSchedulingFailure(result)
        ? Promise.reject(result)
        : Promise.resolve(result);
  }

  return {
    ...actualModule,
    computeScheduleAsync,
  };
});

describe('scheduleUnresolved()', () => {
  const originalDateNow: () => number = global.Date.now;

  afterEach(() => {
    global.Date.now = originalDateNow;
  });

  function realTimeFromEffort(effortMs: number, resolutionMs: number, regularWorkWeekMin: number,
      availabilityPerWeekMin: number): number {
    return Math.ceil(
        Math.ceil(effortMs * (regularWorkWeekMin / availabilityPerWeekMin) / resolutionMs) * resolutionMs *
            MINUTES_PER_WEEK / regularWorkWeekMin
    );
  }

  test('computes schedule and converts from work time to real time', async () => {
    const issues: SchedulableIssue[] = [{
      id: 'issue-1',
      remainingEffortMs: 91,
      remainingWaitTimeMs: 50,
      splittable: true,
      dependencies: [],
      assignee: 'cont-2',
    }, {
      id: 'issue-2',
      remainingEffortMs: 10,
      dependencies: ['issue-3'],
    }, {
      id: 'issue-3',
      remainingEffortMs: 20,
    }];
    const options: SchedulingOptions = {
      contributors: [{
        id: 'cont-1',
        minutesPerWeek: 10,
      }, {
        id: 'cont-2',
        minutesPerWeek: 40,
      }],
      minutesPerWeek: 100,
      resolutionMs: 10,
      predictionStartTimeMs: 1000,
    };
    const workTimeToRealTimeFactor: number = MINUTES_PER_WEEK / options.minutesPerWeek!;
    const schedule: Schedule = await scheduleUnresolved(issues, options);
    const expected: Schedule = [[], [], []];
    expected[0].push({
      assignee: 'cont-1',
      start: options.predictionStartTimeMs!,
      // After quantization, the remaining effort is 100ms. The 2 contributors do 50 min/w.
      end: options.predictionStartTimeMs! + 100 * (options.minutesPerWeek! / 50) * workTimeToRealTimeFactor,
      isWaiting: false,
    });
    expected[0].push({
      ...expected[0][0],
      assignee: 'cont-2',
    });
    expected[0].push({
      assignee: 'cont-2',
      start: expected[0][1].end,
      end: expected[0][1].end + 50 * workTimeToRealTimeFactor,
      isWaiting: true,
    });
    expected[2].push({
      assignee: 'cont-2',
      start: expected[0][1].end,
      end: expected[0][1].end + 20 * (options.minutesPerWeek! / 40) * workTimeToRealTimeFactor,
      isWaiting: false,
    });
    expected[1].push({
      assignee: 'cont-2',
      start: expected[2][0].end,
      // Measured in regular work time, the duration of the task must be a multiple of the resolution.
      end: expected[2][0].end +
          (Math.ceil(10 * (options.minutesPerWeek! / 40) / options.resolutionMs!) *
              options.resolutionMs!) *
          workTimeToRealTimeFactor,
      isWaiting: false,
    });
    expect(schedule).toEqual(expected);
  });

  test('handles zero remaining effort and default prediction start time', async () => {
    const issues: SchedulableIssue[] = [{
      id: 'issue-1',
      remainingEffortMs: 0,
      remainingWaitTimeMs: 0,
    }, {
      id: 'issue-2',
      remainingEffortMs: 0,
      remainingWaitTimeMs: 50,
    }];
    const resolutionMs = 3_600_000;
    const minutesPerWeek = 100;
    const options: SchedulingOptions = {
      contributors: [{
        id: 'cont-1',
        minutesPerWeek: 10,
      }],
      resolutionMs,
      minutesPerWeek,
    };
    const startTime = 1234;
    const expected: Schedule = [[], [{
      assignee: 'cont-1',
      start: startTime,
      end: startTime + resolutionMs * (MINUTES_PER_WEEK / minutesPerWeek),
      isWaiting: true,
    }]];
    Date.now = jest.fn().mockReturnValueOnce(startTime);
    const schedule = await scheduleUnresolved(issues, options);
    await expect(schedule).toEqual(expected);
  });

  test('honors order of issues independently of issue tree', async () => {
    const issues: SchedulableIssue[] = [{
      id: 'task-2',
      remainingEffortMs: 3,
      parent: 'epic-1',
    }, {
      id: 'epic-1',
      remainingEffortMs: 2,
    }];
    const minutesPerWeek = 10;
    const resolutionMs = 1;
    const options: SchedulingOptions = {
      contributors: [{
        id: 'cont-1',
        minutesPerWeek: 10,
      }],
      minutesPerWeek,
      resolutionMs,
      predictionStartTimeMs: 0,
    };
    const expected: Schedule = issues.map(() => []);
    // task-2
    expected[0] = [{
      assignee: 'cont-1',
      start: 0,
      end: realTimeFromEffort(issues[0].remainingEffortMs, resolutionMs, minutesPerWeek,
          options.contributors[0].minutesPerWeek),
      isWaiting: false,
    }];
    // epic-1
    expected[1] = [{
      assignee: 'cont-1',
      start: expected[0][0].end,
      end: expected[0][0].end +
          realTimeFromEffort(issues[1].remainingEffortMs, resolutionMs, minutesPerWeek,
              options.contributors[0].minutesPerWeek),
      isWaiting: false,
    }];
    const schedule = await scheduleUnresolved(issues, options);
    await expect(schedule).toEqual(expected);
  });

  test('handles dependencies on issue with sub-issues', async () => {
    const issues: SchedulableIssue[] = [{
      id: 'task-2',
      remainingEffortMs: 5,
      dependencies: ['epic-1'],
      assignee: 'cont-2',
    }, {
      id: 'task-1-2-1',
      remainingEffortMs: 7,
      parent: 'task-1-2',
      assignee: 'cont-1',
    }, {
      id: 'task-1-1',
      remainingEffortMs: 11,
      parent: 'epic-1',
      assignee: 'cont-1',
    }, {
      id: 'task-1-2',
      remainingEffortMs: 3,
      parent: 'epic-1',
    }, {
      id: 'epic-1',
      remainingEffortMs: 13,
      assignee: 'cont-1',
    }, {
      id: 'task-3',
      remainingEffortMs: 199,
      assignee: 'cont-2',
    }];
    const minutesPerWeek = 10;
    const resolutionMs = 1;
    const predictionStartTimeMs = 123;
    const options: SchedulingOptions = {
      contributors: [{
        id: 'cont-1',
        minutesPerWeek: 10,
      }, {
        id: 'cont-2',
        minutesPerWeek: 20,
      }],
      minutesPerWeek,
      resolutionMs,
      predictionStartTimeMs,
      // Chosen such that there is no preemption.
      minActivityDuration: 200,
    };
    const realTimeFromContEffort = (effortMs: number, contIdx: number) =>
        realTimeFromEffort(effortMs, resolutionMs, minutesPerWeek, options.contributors[contIdx].minutesPerWeek);
    const expected: Schedule = issues.map(() => []);
    // task-1-2-1
    expected[1] = [{
      assignee: 'cont-1',
      start: predictionStartTimeMs,
      end: predictionStartTimeMs + realTimeFromContEffort(7, 0),
      isWaiting: false,
    }];
    // task-1-1
    expected[2] = [{
      assignee: 'cont-1',
      start: expected[1][0].end,
      end: expected[1][0].end + realTimeFromContEffort(11, 0),
      isWaiting: false,
    }];
    // task-1-2
    expected[3] = [{
      assignee: 'cont-2',
      start: predictionStartTimeMs,
      end: predictionStartTimeMs + realTimeFromContEffort(3, 1),
      isWaiting: false,
    }];
    // epic-1
    expected[4] = [{
      assignee: 'cont-1',
      start: expected[2][0].end,
      end: expected[2][0].end + realTimeFromContEffort(13, 0),
      isWaiting: false,
    }];
    // task-2
    expect(expected[4][0].end).toBeGreaterThan(expected[2][0].end);
    expected[0] = [{
      assignee: 'cont-2',
      start: expected[4][0].end,
      end: expected[4][0].end + realTimeFromContEffort(5, 1),
      isWaiting: false,
    }];
    // task-3. Note that it must be scheduled after task-2.
    expected[5] = [{
      assignee: 'cont-2',
      start: expected[0][0].end,
      end: expected[0][0].end + realTimeFromContEffort(199, 1),
      isWaiting: false,
    }];
    const schedule = await scheduleUnresolved(issues, options);
    await expect(schedule).toEqual(expected);
  });

  test('handles dependencies by issues with sub-issues', async () => {
    const issues: SchedulableIssue[] = [{
      id: 'task-1-1',
      remainingEffortMs: 11,
      parent: 'epic-1',
    }, {
      id: 'epic-1',
      remainingEffortMs: 0,
      dependencies: ['task-1'],
    }, {
      id: 'task-1',
      remainingEffortMs: 7,
    }];
    const minutesPerWeek = 10;
    const resolutionMs = 1;
    const options: SchedulingOptions = {
      contributors: [{
        id: 'cont-1',
        minutesPerWeek: 10,
      }],
      minutesPerWeek,
      resolutionMs,
      predictionStartTimeMs: 0,
    };
    const expected: Schedule = issues.map(() => []);
    // task-1
    expected[2] = [{
      assignee: 'cont-1',
      start: 0,
      end: realTimeFromEffort(7, resolutionMs, minutesPerWeek, options.contributors[0].minutesPerWeek),
      isWaiting: false,
    }];
    // task-1-1
    expected[0] = [{
      assignee: 'cont-1',
      start: expected[2][0].end,
      end: expected[2][0].end +
          realTimeFromEffort(11, resolutionMs, minutesPerWeek, options.contributors[0].minutesPerWeek),
      isWaiting: false,
    }];
    // epic-1
    expected[1] = [];
    const schedule = await scheduleUnresolved(issues, options);
    await expect(schedule).toEqual(expected);
  });

  test.each<[number, boolean]>([
    [60, true],
    [61, false],
  ])('handles minActivityDuration (minActivityDuration = %d, expectPreemption = %p)',
      async (minActivityDuration, expectPreemption) => {
    // minActivityDuration is given in minutes, because the resolution is 1 minute.
    const issues: SchedulableIssue[] = [{
      id: 'task-1',
      remainingEffortMs: 3_600_000,
      assignee: 'cont-1',
    }, {
      id: 'task-2',
      remainingEffortMs: 3_600_000,
      assignee: 'cont-2',
      dependencies: ['task-1'],
    }, {
      id: 'task-3',
      remainingEffortMs: 7_200_000,
      assignee: 'cont-2',
    }];
    const options: SchedulingOptions = {
      contributors: [{
        id: 'cont-1',
        minutesPerWeek: 60,
      }, {
        id: 'cont-2',
        minutesPerWeek: 60,
      }],
      minutesPerWeek: 60,
      // Resolution is 1 minute.
      resolutionMs: 60_000,
      minActivityDuration,
      predictionStartTimeMs: 0,
    };
    const schedule = await scheduleUnresolved(issues, options);
    await expect(schedule[2].length).toEqual(expectPreemption ? 2 : 1);
  });
});

describe('appendSchedule()', () => {
  function newIssueDefaults() {
    return {
      summary: '',
      state: 'in-progress',
      resolved: 0,
      assignee: '',
      parent: '',
      customFields: {},
      remainingEffortMs: 1000,
      remainingWaitTimeMs: 500,
      splittable: true,
      dependencies: [],
    };
  }

  test('rejects different number of issues', () => {
    const projectPlan: ProjectPlan = {
      issues: [],
      warnings: [],
    };
    const schedule: Schedule = [[{
      assignee: 'assignee',
      start: 10,
      end: 20,
      isWaiting: false,
    }]];
    expect(appendSchedule(projectPlan, schedule, 15)).toContain('different number of issues');
  });

  test('removes activities beyond division timestamp', () => {
    const projectPlan: ProjectPlan = {
      issues: [{
        ...newIssueDefaults(),
        id: '1',
        issueActivities: [{
          assignee: 'assignee-1',
          start: 50,
          end: 100,
          isWaiting: false,
        }],
      }],
      warnings: [],
    };
    const schedule: Schedule = [[{
      assignee: 'assignee-1',
      start: 60,
      end: 110,
      isWaiting: false,
    }]];

    const result40: ProjectPlan | Failure = appendSchedule(projectPlan, schedule, 40);
    const expected40: ProjectPlan = {
      issues: [{
        ...newIssueDefaults(),
        id: '1',
        issueActivities: [{
          assignee: 'assignee-1',
          start: 60,
          end: 110,
          isWaiting: false,
        }],
      }],
      warnings: [],
    };
    expect(result40).toEqual(expected40);

    const result120: ProjectPlan | Failure = appendSchedule(projectPlan, schedule, 120);
    const expected120: ProjectPlan = {
      issues: [{
        ...newIssueDefaults(),
        id: '1',
        issueActivities: [{
          assignee: 'assignee-1',
          start: 50,
          end: 100,
          isWaiting: false,
        }],
      }],
      warnings: [],
    };
    expect(result120).toEqual(expected120);
  });

  test('merges activities in project plan and upcoming schedule', () => {
    const projectPlan: ProjectPlan = {
      issues: [{
        ...newIssueDefaults(),
        id: '1',
        issueActivities: [{
          assignee: 'assignee-1',
          start: 10,
          end: 25,
          isWaiting: false,
        }],
      }],
      warnings: [{
        description: 'warning-1',
        issueId: '1',
      }],
    };
    const schedule: Schedule = [[{
      assignee: 'assignee-1',
      start: 20,
      end: 50,
      isWaiting: false,
    }]];
    const result: ProjectPlan | Failure = appendSchedule(projectPlan, schedule, 20);
    const expected: ProjectPlan = {
      issues: [{
        ...newIssueDefaults(),
        id: '1',
        issueActivities: [{
          assignee: 'assignee-1',
          start: 10,
          end: 50,
          isWaiting: false,
        }],
      }],
      warnings: deepClone(projectPlan.warnings),
    };
    expect(result).toEqual(expected);
  });

  test('sorts activities in project plan', () => {
    const projectPlan: ProjectPlan = {
      issues: [{
        ...newIssueDefaults(),
        id: '1',
        issueActivities: [{
          assignee: 'assignee-1',
          start: 0,
          end: 10,
          isWaiting: false,
        }, {
          assignee: 'assignee-1',
          start: 10,
          end: 20,
          isWaiting: true,
        }],
      }],
      warnings: [],
    };
    const schedule: Schedule = [[{
      assignee: 'assignee-2',
      start: 100,
      end: 120,
      isWaiting: false,
    }, {
      assignee: 'assignee-1',
      start: 100,
      end: 120,
      isWaiting: false,
    }]];
    const result: ProjectPlan | Failure = appendSchedule(projectPlan, schedule, 100);
    const expected: ProjectPlan = {
      issues: [{
        ...newIssueDefaults(),
        id: '1',
        issueActivities: [
          projectPlan.issues[0].issueActivities[0],
          projectPlan.issues[0].issueActivities[1], {
            assignee: 'assignee-1',
            start: 100,
            end: 120,
            isWaiting: false,
          }, {
            assignee: 'assignee-2',
            start: 100,
            end: 120,
            isWaiting: false,
          },
        ],
      }],
      warnings: [],
    };
    expect(result).toEqual(expected);
  });
});

describe('groupByIntervalAndWaitStatus()', () => {
  test('handles trivial input', () => {
    expect(groupByIntervalAndWaitStatus([])).toEqual([]);
  });

  describe('handles elementary transformations', () => {
    test.each<[IssueActivity[], MultiAssigneeIssueActivity[]]>([
      [
        [{assignee: 'a', start: 0, end: 1, isWaiting: false}, {assignee: 'a', start: 2, end: 3, isWaiting: false}],
        [
          {assignees: ['a'], start: 0, end: 1, isWaiting: false},
          {assignees: ['a'], start: 2, end: 3, isWaiting: false},
        ],
      ],
      [
        [{assignee: 'a', start: 0, end: 1, isWaiting: false}, {assignee: 'a', start: 1, end: 2, isWaiting: true}],
        [{assignees: ['a'], start: 0, end: 1, isWaiting: false}, {assignees: ['a'], start: 1, end: 2, isWaiting: true}],
      ],
    ])('groupByIntervalAndWaitStatus(%j) === %j', (activities, expected) => {
      expect(groupByIntervalAndWaitStatus(activities)).toEqual(expected);
    });
  });

  describe('handles non-normalized input', () =>  {
    // Supported even though such an IssueActivity[] would not be returned by any of our API.
    test.each<[IssueActivity[], MultiAssigneeIssueActivity[]]>([
      [
        [{assignee: 'a', start: 0, end: 1, isWaiting: false}, {assignee: 'a', start: 1, end: 2, isWaiting: false}],
        [{assignees: ['a'], start: 0, end: 2, isWaiting: false}],
      ],
      [
        [{assignee: 'a', start: 0, end: 2, isWaiting: false}, {assignee: 'a', start: 1, end: 3, isWaiting: false}],
        [{assignees: ['a'], start: 0, end: 3, isWaiting: false}],
      ],
    ])('groupByIntervalAndWaitStatus(%j) === %j', (activities, expected) => {
      expect(groupByIntervalAndWaitStatus(activities)).toEqual(expected);
    });
  });

  describe('handles merging multiple users', () => {
    test.each<[IssueActivity[], MultiAssigneeIssueActivity[]]>([
      [
        [{assignee: 'a', start: 0, end: 2, isWaiting: false}, {assignee: 'b', start: 1, end: 3, isWaiting: false}],
        [
          {assignees: ['a'], start: 0, end: 1, isWaiting: false},
          {assignees: ['a', 'b'], start: 1, end: 2, isWaiting: false},
          {assignees: ['b'], start: 2, end: 3, isWaiting: false},
        ],
      ],
    ])('groupByIntervalAndWaitStatus(%j) === %j', (activities, expected) => {
      expect(groupByIntervalAndWaitStatus(activities)).toEqual(expected);
    });
  });

  describe('groups also by wait status, and returns sorted output', () => {
    test.each<[IssueActivity[], MultiAssigneeIssueActivity[]]>([
      [
        [
          {assignee: 'b', start: 1, end: 5, isWaiting: true},
          {assignee: 'c', start: 1, end: 2, isWaiting: false},
          {assignee: 'a', start: 5, end: 7, isWaiting: false},
          {assignee: 'c', start: 3, end: 6, isWaiting: false},
        ],
        [
          {assignees: ['c'], start: 1, end: 2, isWaiting: false},
          {assignees: ['b'], start: 1, end: 5, isWaiting: true},
          {assignees: ['c'], start: 3, end: 5, isWaiting: false},
          {assignees: ['a', 'c'], start: 5, end: 6, isWaiting: false},
          {assignees: ['a'], start: 6, end: 7, isWaiting: false},
        ],
      ],
    ])('groupByIntervalAndWaitStatus(%j) === %j', (activities, expected) => {
      expect(groupByIntervalAndWaitStatus(activities)).toEqual(expected);
    });
  });
});
