import * as ProjectPlanningJs from '@fschopp/project-planning-js';
import {
  Contributor, Failure,
  IssueActivity, ProjectPlan,
  SchedulableIssue,
  Schedule,
  SchedulingOptions, YouTrackIssue,
} from './api-types';
import { assignDefined, coalesce, deepClone, OnlyOptionals } from './util';

/**
 * Computes and returns a schedule for the given issues.
 *
 * @param issues issues that need to be scheduled
 * @param options scheduling options
 * @return promise that will be resolved with the schedule or rejected with a {@link Failure} containing a
 *     human-readable failure description if the problem instance is invalid (for example, has a cyclic dependency
 *     graph)
 */
export async function scheduleUnresolved(issues: SchedulableIssue[], options: SchedulingOptions):
    Promise<Schedule> {
  const actualOptions: Required<SchedulingOptions> = assignDefined(newDefaultSchedulingOptions(), options);

  const schedule: IssueActivity[][] = issues.map((ignoredIssue) => []);

  // Invariant: n === machineIdxToContributorIdx.length === schedulingInstance.machineSpeeds.length
  let n: number = 0;
  const assigneeToContributorIdx = new Map<string, number>();
  const machineIdxToContributorIdx: number[] = [];
  const schedulingInstance: ProjectPlanningJs.SchedulingInstance = {
    machineSpeeds: [],
    jobs: [],
    minFragmentSize: actualOptions.minActivityDuration,
  };
  for (let i = 0; i < actualOptions.contributors.length; ++i) {
    const contributor: Contributor = actualOptions.contributors[i];
    assigneeToContributorIdx.set(contributor.id, i);
    const numMembers: number = coalesce(contributor.numMembers, 1);
    machineIdxToContributorIdx.length = n + numMembers;
    machineIdxToContributorIdx.fill(i, n, n + numMembers);
    schedulingInstance.machineSpeeds.length = n + numMembers;
    schedulingInstance.machineSpeeds.fill(contributor.minutesPerWeek, n, n + numMembers);
    n += numMembers;
  }
  const issueIdToJobIdx = new Map<string, number>();
  const jobIdxToIssueIdx: number[] = [];
  for (let j = 0; j < issues.length; ++j) {
    const issue: SchedulableIssue = issues[j];
    if (issue.remainingEffortMs > 0 || coalesce(issue.remainingWaitTimeMs, 0) > 0) {
      issueIdToJobIdx.set(issue.id, jobIdxToIssueIdx.length);
      jobIdxToIssueIdx.push(j);
    }
  }
  for (const jobIdx of issueIdToJobIdx.values()) {
    const issue: Required<SchedulableIssue> =
        assignDefined(newDefaultSchedulableIssue(), issues[jobIdxToIssueIdx[jobIdx]]);
    const job: ProjectPlanningJs.Job = {
      size: Math.ceil(issue.remainingEffortMs / actualOptions.resolutionMs) * actualOptions.minutesPerWeek,
      deliveryTime: Math.ceil(issue.remainingWaitTimeMs / actualOptions.resolutionMs),
      splitting: issue.splittable
          ? ProjectPlanningJs.JobSplitting.MULTIPLE_MACHINES
          : ProjectPlanningJs.JobSplitting.PREEMPTION,
      dependencies: issue.dependencies
          .map((depIssueId): number | undefined => issueIdToJobIdx.get(depIssueId))
          .filter((depJobIdx): depJobIdx is number => depJobIdx !== undefined),
      preAssignment: issue.assignee.length > 0
          ? assigneeToContributorIdx.get(issue.assignee)
          : undefined,
    };
    schedulingInstance.jobs.push(job);
  }

  const machineSchedule: ProjectPlanningJs.Schedule = await ProjectPlanningJs.computeScheduleAsync(schedulingInstance);
  const realTimeFactor = MINUTES_PER_WEEK_REAL_TIME / actualOptions.minutesPerWeek;
  const scheduleTimestampToEpochTime = (timestamp: number): number => Math.ceil(
      actualOptions.predictionStartTimeMs + timestamp * actualOptions.resolutionMs * realTimeFactor);
  for (let j = 0; j < machineSchedule.length; ++j) {
    const scheduledJob: ProjectPlanningJs.ScheduledJob = machineSchedule[j];
    const scheduledIssue: IssueActivity[] = schedule[jobIdxToIssueIdx[j]];
    for (const jobFragment of scheduledJob) {
      const issueActivity: IssueActivity = {
        assignee: actualOptions.contributors[machineIdxToContributorIdx[jobFragment.machine]].id,
        start: scheduleTimestampToEpochTime(jobFragment.start),
        end: scheduleTimestampToEpochTime(jobFragment.end),
        isWaiting: jobFragment.isWaiting,
      };
      scheduledIssue.push(issueActivity);
    }
  }
  return schedule;
}

/**
 * Appends a schedule for issues with remaining effort or wait time to a project plan.
 *
 * This function does not modify any of its arguments. It returns an entirely new instance that shares no mutable data
 * with `projectPlan`.
 *
 * This function merges any issue activity in `projectPlan` that extends into an activity in `schedule` for the same
 * issue and by the same contributor. It removes all issue activities in `projectPlan` that start after the first
 * activity in `schedule` for the same issue and contributor.
 *
 * @param projectPlan the project plan, typically containing only past issue activities
 * @param schedule the (future) schedule for issues with remaining effort or wait time
 * @param divisionTimestamp Timestamp taken as end for the project plan and as beginning for the future schedule. Any
 *     project-plan activities starting after this timestamp, and any schedule activities ending before this timestamp
 *     are omitted.
 * @return a new project plan that contains the issue activities of both `projectPlan` and `schedule`
 */
export function appendSchedule(projectPlan: ProjectPlan, schedule: Schedule, divisionTimestamp: number):
    ProjectPlan | Failure {
  if (projectPlan.issues.length !== schedule.length) {
    return 'The given project plan and the new schedule have a different number of issues.';
  }

  const collator = new Intl.Collator('en');
  const newProjectPlan: ProjectPlan = deepClone(projectPlan);
  for (let issueIdx = 0; issueIdx < newProjectPlan.issues.length; ++issueIdx) {
    const issue: YouTrackIssue = newProjectPlan.issues[issueIdx];
    // The following statement means "group by assignee"
    const assigneeToActivities = new Map<string, IssueActivity[]>();
    const existingActivities: IssueActivity[] = [];
    for (const issueActivity of issue.issueActivities) {
      if (issueActivity.start < divisionTimestamp) {
        issueActivity.end = Math.min(issueActivity.end, divisionTimestamp);
        if (assigneeToActivities.has(issueActivity.assignee)) {
          assigneeToActivities.get(issueActivity.assignee)!.push(issueActivity);
        } else {
          assigneeToActivities.set(issueActivity.assignee, [issueActivity]);
        }
        existingActivities.push(issueActivity);
      }
    }
    issue.issueActivities = existingActivities;

    const createIfAbsent = (assignee: string): IssueActivity[] => {
      if (assigneeToActivities.has(assignee)) {
        return assigneeToActivities.get(assignee)!;
      } else {
        const returnValue: IssueActivity[] = [];
        assigneeToActivities.set(assignee, returnValue);
        return returnValue;
      }
    };

    for (const scheduledActivity of schedule[issueIdx]) {
      if (scheduledActivity.end <= divisionTimestamp) {
        continue;
      }
      const newActivity: IssueActivity = {
        ...scheduledActivity,
        start: Math.max(scheduledActivity.start, divisionTimestamp),
      };
      const assigneeActivities: IssueActivity[] = createIfAbsent(scheduledActivity.assignee);
      if (assigneeActivities.length > 0 &&
          assigneeActivities[assigneeActivities.length - 1].end === newActivity.start &&
          assigneeActivities[assigneeActivities.length - 1].isWaiting === newActivity.isWaiting) {
        assigneeActivities[assigneeActivities.length - 1].end = newActivity.end;
      } else {
        assigneeActivities.push(newActivity);
        issue.issueActivities.push(newActivity);
      }
    }

    issue.issueActivities.sort((left, right) => {
      const diff = left.end - right.end;
      return diff !== 0
          ? diff
          : collator.compare(left.assignee, right.assignee);
    });
  }
  return newProjectPlan;
}

/**
 * Returns a new object with values for the optional properties of {@link SchedulableIssue}.
 */
function newDefaultSchedulableIssue(): OnlyOptionals<SchedulableIssue> {
  return {
    remainingWaitTimeMs: 0,
    splittable: false,
    dependencies: [],
    assignee: '',
  };
}

/**
 * Returns a new object with values for the optional properties of {@link SchedulingOptions}.
 */
function newDefaultSchedulingOptions(): OnlyOptionals<SchedulingOptions> {
  return {
    minutesPerWeek: 5 * 8 * 60,
    resolutionMs: 60 * 60 * 1000,
    minActivityDuration: 1,
    predictionStartTimeMs: Date.now(),
  };
}

/**
 * The number of minutes per week, in real time.
 */
const MINUTES_PER_WEEK_REAL_TIME = 7 * 24 * 60;
