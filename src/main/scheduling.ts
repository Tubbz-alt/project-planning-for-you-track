import * as ProjectPlanningJs from '@fschopp/project-planning-js';
import { strict as assert } from 'assert';
import {
  Contributor,
  Failure,
  IssueActivity,
  IssueNode,
  MultiAssigneeIssueActivity,
  ProjectPlan,
  SchedulableIssue,
  Schedule,
  SchedulingOptions,
  YouTrackIssue,
} from './api-types';
import { makeForest, traverseIssueForest } from './issue-forest';
import { assignDefined, coalesce, deepClone, OnlyOptionals } from './util';

/**
 * Computes and returns a schedule for the given issues.
 *
 * The problem of scheduling issues is transformed (“[reduced](https://en.wikipedia.org/wiki/Reduction_(complexity))”)
 * to the machine-scheduling problem, which is then solved using the *list-scheduling* algorithm from project
 * [fschopp/project-planning-js](https://github.com/fschopp/project-planning-js).
 *
 * Issues are scheduled in input order, subject to issue dependencies. Note that if an issue A depends on another
 * issue B, then A also depends on all of B’s sub-issues. Beyond that, parent-child relationships do *not* influence the
 * scheduling order. That is, if both an issue and its sub-issue have non-zero remaining effort, then both issues’ *own*
 * (excluding sub-issues) processing will occur in input order.
 *
 * @param issues Array of issues that need to be scheduled. The array is expected to be “closed” in the sense that a
 *     parent or dependency referenced by any of the issues is guaranteed to be contained in `issues`, too. That is,
 *     despite the name of this function, it is *not* expected that all issue are unresolved.
 * @param options scheduling options
 * @return promise that will be resolved with the schedule or rejected with a {@link Failure} containing a
 *     human-readable failure description if the problem instance is invalid (for example, has a cyclic dependency
 *     graph)
 */
export async function scheduleUnresolved(issues: SchedulableIssue[], options: SchedulingOptions):
    Promise<Schedule> {
  const actualOptions: Required<SchedulingOptions> = assignDefined(newDefaultSchedulingOptions(), options);
  const {jobIdxToExtendedIssue, machineIdxToContributorIdx, schedulingInstance} =
      makeSchedulingInstance(issues, actualOptions);
  const machineSchedule: ProjectPlanningJs.Schedule = await ProjectPlanningJs.computeScheduleAsync(schedulingInstance);
  const realTimeFactor = MINUTES_PER_WEEK_REAL_TIME / actualOptions.minutesPerWeek;
  const schedule: IssueActivity[][] = issues.map(() => []);
  const scheduleTimestampToEpochTime = (timestamp: number): number => Math.ceil(
      actualOptions.predictionStartTimeMs + timestamp * actualOptions.resolutionMs * realTimeFactor);
  for (let j = 0; j < machineSchedule.length; ++j) {
    const scheduledJob: ProjectPlanningJs.ScheduledJob = machineSchedule[j];
    const scheduledIssue: IssueActivity[] = schedule[jobIdxToExtendedIssue[j].issueIdx];
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
 * issue and by the same contributor.
 *
 * @param projectPlan the project plan, typically containing only past issue activities
 * @param schedule the (future) schedule for issues with remaining effort or wait time
 * @param divisionTimestamp Timestamp taken as end for the project plan and as beginning for the future schedule. Any
 *     project-plan activities starting at or after this timestamp, and any schedule activities ending at or before this
 *     timestamp are omitted.
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
 * Returns the given issue activities grouped by interval and wait status.
 *
 * Every point in time is represented by at most two {@link MultiAssigneeIssueActivity} elements in the returned array;
 * one for all assignees that are not waiting, and one for all that are. Each {@link MultiAssigneeIssueActivity} element
 * has maximum length. In other words, no two {@link MultiAssigneeIssueActivity} elements could be merged into one.
 *
 * This function can be thought to work as follows: It first separates the activities according to wait status. Then,
 * for both groups: It projects all start and end timestamps of the given activities onto a single timeline. It then
 * iterates over these timestamps, and whenever the set of assignees changes:
 * 1. The current {@link MultiAssigneeIssueActivity} (if any) is ended.
 * 2. A new {@link MultiAssigneeIssueActivity} is added if the new set of assignees is non-empty.
 * As last step, the non-waiting and waiting activities are merged (and sorted).
 *
 * Note that all functions in this package that return arrays of {@link IssueActivity} guarantee a “normalized” form.
 * See, for instance, {@link YouTrackIssue.issueActivities}. With these extra guarantees, no activities in the array
 * return by this function ever overlap.
 *
 * This function treats activities with empty {@link IssueActivity.assignee} in the same way as all other activities.
 * That is, within this function, the empty string is a valid assignee name.
 *
 * @param activities The issue activities. The array does not have to be “normalized.”
 * @return The array of issue activities grouped by interval and wait status. The array will be sorted by the `start`
 *     and then by the `isWaiting` properties. The {@link MultiAssigneeIssueActivity.assignees} property of each element
 *     is guaranteed to be sorted, too.
 */
export function groupByIntervalAndWaitStatus(activities: IssueActivity[]): MultiAssigneeIssueActivity[] {
  enum IssueEventType {
    ADDED = 0,
    REMOVED = 1,
  }
  interface IssueEvent {
    type: IssueEventType;
    assignee: string;
    timestamp: number;
    isWaiting: boolean;
  }
  const result: MultiAssigneeIssueActivity[] = [];
  for (const isWaiting of [false, true]) {
    const events: IssueEvent[] = [];
    for (const activity of filter(activities, (filterActivity) => filterActivity.isWaiting === isWaiting)) {
      const assignee = activity.assignee;
      events.push(
          {type: IssueEventType.ADDED, assignee, timestamp: activity.start, isWaiting},
          {type: IssueEventType.REMOVED, assignee, timestamp: activity.end, isWaiting}
      );
    }
    events.sort((first, second) => first.timestamp - second.timestamp);

    let lastActivity: MultiAssigneeIssueActivity = {
      assignees: [],
      start: Number.MIN_SAFE_INTEGER,
      end: Number.MAX_SAFE_INTEGER,
      isWaiting: false,
    };
    let lastTimestamp: number = Number.MIN_SAFE_INTEGER;
    const assigneeToActivityCount = new Map<string, number>();
    for (const event of events) {
      if (event.timestamp > lastTimestamp) {
        lastActivity = timePassed(lastActivity, lastTimestamp, assigneeToActivityCount, result, isWaiting);
      }

      let assigneeActiveCount: number = coalesce(assigneeToActivityCount.get(event.assignee), 0);
      if (event.type === IssueEventType.REMOVED) {
        --assigneeActiveCount;
      } else {
        ++assigneeActiveCount;
      }
      assert(assigneeActiveCount >= 0, 'count cannot become negative');
      assigneeToActivityCount.set(event.assignee, assigneeActiveCount);
      lastTimestamp = event.timestamp;
    }
    timePassed(lastActivity, lastTimestamp, assigneeToActivityCount, result, isWaiting);
  }
  result.sort((first, second) => first.start === second.start
      ? (+first.isWaiting) - (+second.isWaiting)
      : first.start - second.start);
  return result;
}


/**
 * Mapping between an issue and (either one or two) jobs in the machine scheduling problem.
 */
interface ExtendedIssue extends Required<SchedulableIssue> {
  /**
   * Index of this issue in the original (flat) array that was used to create this extended issue.
   */
  issueIdx: number;

  /**
   * Index of the “main” scheduling job corresponding to the current issue.
   *
   * This job has a size computed from {@link SchedulableIssue.remainingEffortMs}, etc.
   */
  jobIdx: number;

  /**
   * Index of the “associated” job corresponding to the current issue.
   *
   * The main job corresponding to any dependent issue must have a dependency on this job index (and not
   * {@link jobIdx}).
   *
   * If the current issue has sub-issues, this will be a dummy job with size 0. It depends on all associated jobs
   * corresponding to its (direct) sub-issues. Otherwise, if the current issue has no sub-issues, this will be the
   * same as {@link jobIdx}.
   */
  asDependencyJobIdx: number;
}


/**
 * The number of minutes per week, in real time.
 */
const MINUTES_PER_WEEK_REAL_TIME = 7 * 24 * 60;

/**
 * Returns a new object with values for the optional properties of {@link SchedulableIssue}.
 */
function newDefaultSchedulableIssue(): OnlyOptionals<SchedulableIssue> {
  return {
    remainingWaitTimeMs: 0,
    parent: '',
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
 * Returns a machine-scheduling problem instance for the given issues, thereby “reducing” the problem to a another one
 * for that a solver already exists.
 */
function makeSchedulingInstance(issues: SchedulableIssue[], actualOptions: Required<SchedulingOptions>):
    {
      jobIdxToExtendedIssue: ExtendedIssue[];
      machineIdxToContributorIdx: number[];
      schedulingInstance: ProjectPlanningJs.SchedulingInstance;
    } {
  const jobIdxToExtendedIssue: ExtendedIssue[] = [];
  const machineIdxToContributorIdx: number[] = [];

  // Invariant: n === machineIdxToContributorIdx.length === schedulingInstance.machineSpeeds.length
  let n: number = 0;
  const assigneeToContributorIdx = new Map<string, number>();
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

  // First pass over issues: Fill in issues with defaults, and create bi-direcitonal mapping with job indices.
  const extendedIssues: ExtendedIssue[] = issues.map((issue, issueIdx) => {
    const jobIdx = jobIdxToExtendedIssue.length;
    const extendedIssue: ExtendedIssue = {
      ...assignDefined(newDefaultSchedulableIssue(), issue),
      issueIdx,
      jobIdx,
      asDependencyJobIdx: jobIdx,
    };
    jobIdxToExtendedIssue.push(extendedIssue);
    return extendedIssue;
  });
  const nodesWithDummyJobs: IssueNode<ExtendedIssue>[] = [];
  const nodes: IssueNode<ExtendedIssue>[] = [];
  nodes.length = extendedIssues.length;
  // Seconds pass over issues: Build tree and add mappings for "dummy" jobs.
  traverseIssueForest(makeForest(extendedIssues), (node) => {
    nodes[node.index] = node;

    if (node.children.length > 0) {
      node.issue.asDependencyJobIdx = jobIdxToExtendedIssue.length;
      jobIdxToExtendedIssue.push(node.issue);
      nodesWithDummyJobs.push(node);
    }
  });
  // reduce() does *not* call callbackfn for empty slots, so the assert is reasonable:
  // https://www.ecma-international.org/ecma-262/5.1/#sec-15.4.4.21
  assert(nodes.reduce((count) => count + 1, 0) === extendedIssues.length, 'Traversal must have visited all issues');

  // Third path: Finally create the jobs for the machine-scheduling problem.
  for (let i = 0; i < extendedIssues.length; ++i) {
    const issue: ExtendedIssue = extendedIssues[i];
    const node: IssueNode<ExtendedIssue> = nodes[i];
    assert(node.issue === issue && node.index === issue.issueIdx);

    schedulingInstance.jobs.push({
      size: Math.ceil(issue.remainingEffortMs / actualOptions.resolutionMs) * actualOptions.minutesPerWeek,
      deliveryTime: Math.ceil(issue.remainingWaitTimeMs / actualOptions.resolutionMs),
      splitting: issue.splittable
          ? ProjectPlanningJs.JobSplitting.MULTIPLE_MACHINES
          : ProjectPlanningJs.JobSplitting.PREEMPTION,
      dependencies: node.dependencies.map((dependencyNode) => dependencyNode.issue.asDependencyJobIdx),
      preAssignment: issue.assignee.length > 0
          ? assigneeToContributorIdx.get(issue.assignee)
          : undefined,
    });
  }
  for (const node of nodesWithDummyJobs) {
    schedulingInstance.jobs.push({
      size: 0,
      dependencies: node.children
          .map((childNode) => childNode.issue.asDependencyJobIdx)
          .concat(node.issue.jobIdx),
    });
  }
  return {jobIdxToExtendedIssue, machineIdxToContributorIdx, schedulingInstance};
}

/**
 * Commits the last issue activity if the set of assignees changed at the last timestamp.
 *
 * This function is called because time progressed from `lastTimestamp` to `x`, so the interval between `lastTimestamp`
 * and `x` becomes “settled.”
 *
 * Note that there are 3 logical timestamps of relevance here:
 * 1. The timestamp when `lastActivity` started. This is simply `lastActivity.start`.
 * 2. The timestamp of the last event prior to the current time. This is `lastTimestamp`.
 * 3. The current time. This function does not need an exact value, so it may be an arbitrary value
 *    `x > lastTimestamp`.
 *
 * @param lastActivity The activity that is known to have lasted (at least) until timestamp `lastTimestamp`. That is,
 *     `lastActivity.assignees` contains the set of assignees between timestamps `lastActivity.start` and
 *     `lastTimestamp`.
 * @param lastTimestamp The timestamp of the last event (prior to the current time `x`). It holds that
 *     `lastTimestamp < x`. If the set of assignees changed at `lastTimestamp`, then this function updates
 *     `lastActivity` and adds it to `result` (assuming there was at least one assignee between timestamps
 *     `lastActivity.start` and `lastTimestamp`).
 * @param currentAssignees The set of assignees between timestamp `lastTimestamp` and `x`.
 * @param result The array of activities that `lastActivity` will be added to if the set of assignees changed at
 *     timestamp `lastTimestamp`.
 * @param isWaiting If this function returns a new activity (starting at `lastTimestamp`), the value for the
 *     `isWaiting` property.
 * @return The current activity that is known to have lasted (at least) until timestamp `x`.
 */
function timePassed(lastActivity: MultiAssigneeIssueActivity, lastTimestamp: number,
    currentAssignees: Map<string, number>, result: MultiAssigneeIssueActivity[], isWaiting: boolean):
    MultiAssigneeIssueActivity {
  let assigneesChanged: boolean = false;
  for (const assignee of lastActivity.assignees) {
    if (coalesce(currentAssignees.get(assignee), 0) <= 0) {
      assigneesChanged = true;
      break;
    }
  }
  const assignees: string[] = [];
  for (const [assignee, activeCount] of currentAssignees.entries()) {
    if (activeCount > 0) {
      assignees.push(assignee);
    }
  }
  assigneesChanged = assigneesChanged || lastActivity.assignees.length !== assignees.length;
  if (assigneesChanged) {
    if (lastActivity.assignees.length > 0) {
      lastActivity.end = lastTimestamp;
      result.push(lastActivity);
    }
    assignees.sort();
    return {
      assignees,
      start: lastTimestamp,
      end: Number.MAX_SAFE_INTEGER,
      isWaiting,
    };
  } else {
    return lastActivity;
  }
}

function* filter<T>(iterable: Iterable<T>, predicate: (val: T) => boolean): Iterable<T> {
  for (const value of iterable) {
    if (predicate(value)) {
      yield value;
    }
  }
}
