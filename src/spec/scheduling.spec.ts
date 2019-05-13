import * as ProjectPlanningJs from '@fschopp/project-planning-js';
import {
  appendSchedule, Failure,
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

  test('computes schedule and coverts from work time to real time', async () => {
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

  test('handles zero remaining effort', async () => {
    const issues: SchedulableIssue[] = [{
      id: 'issue-1',
      remainingEffortMs: 0,
      remainingWaitTimeMs: 0,
    }, {
      id: 'issue-2',
      remainingEffortMs: 0,
      remainingWaitTimeMs: 50,
    }];
    const options: SchedulingOptions = {
      contributors: [{
        id: 'cont-1',
        minutesPerWeek: 10,
      }],
      minutesPerWeek: 100,
    };
    const startTime = 1234;
    const expected: Schedule = [[], [{
      assignee: 'cont-1',
      start: startTime,
      end: startTime + 3600000 * (MINUTES_PER_WEEK / options.minutesPerWeek!),
      isWaiting: true,
    }]];
    Date.now = jest.fn().mockReturnValueOnce(startTime);
    const schedule = await scheduleUnresolved(issues, options);
    await expect(schedule).toEqual(expected);
  });
});

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

describe('appendSchedule()', () => {
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
