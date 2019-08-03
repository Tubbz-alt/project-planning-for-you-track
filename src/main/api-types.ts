/**
 * Contributor to a project to whom work can be assigned.
 *
 * A contributor can have one or more members.
 */
export interface Contributor {
  /**
   * Identifier for this contributor. If the contributor exists in YouTrack as a user, this should be the
   * YouTrack-internal ID (YouTrack REST API entity name
   * [User](https://www.jetbrains.com/help/youtrack/standalone/api-entity-User.html)), so that issue assignees in
   * YouTrack can be considered for scheduling.
   */
  id: string;

  /**
   * The number of minutes per week each member of this contributor is available.
   */
  minutesPerWeek: number;

  /**
   * The number of members in this group.
   *
   * By default, there is only a single member; that is, 1.
   */
  numMembers?: number;
}

/**
 * Human-readable error message that can be displayed to the user.
 */
export type Failure = string;

/**
 * Returns whether the given value is a {@link Failure}.
 */
export function isFailure(value: any): value is Failure {
  return typeof value === 'string';
}

/**
 * An issue activity is a time period in which work was or is scheduled to be performed on an issue.
 *
 * Timestamps are in milliseconds since January 1, 1970 00:00:00 UTC. That is, all timestamps are in real time (and not
 * relative to work time).
 */
export interface IssueActivity {
  /**
   * If the activity is in the past: YouTrack-internal ID of the assignee (YouTrack REST API entity name
   * [User](https://www.jetbrains.com/help/youtrack/standalone/api-entity-User.html)) or, if there was no assignee,
   * the empty string. If the activity is scheduled for the future: the contributor id {@link Contributor.id}.
   */
  assignee: string;

  /**
   * The start timestamp of the activity (including).
   */
  start: number;

  /**
   * The end timestamp of the activity (excluding).
   *
   * If the issue activity has no scheduled end, this property is `Number.MAX_SAFE_INTEGER`.
   */
  end: number;

  /**
   * Whether this activity represents wait time.
   *
   * If true, this activity does not prevent other issues from being assigned concurrently to the same assignee.
   * However, any dependent issue can only start once all work on this issue has finished and all wait time has elapsed.
   */
  isWaiting: boolean;
}

/**
 * Node in an issue tree (or forest).
 *
 * In an issue tree (or forest), there is a one-to-one correspondence between {@link SchedulableIssue} objects and
 * {@link IssueNode} objects. Parent-child and dependency relationships are “lifted” to {@link IssueNode}. That is, the
 * dependencies of an {@link IssueNode} `a` are just those nodes that correspond to the issues referenced by
 * `a.issue.dependencies`.
 *
 * See also {@link makeForest}().
 */
export interface IssueNode<T extends SchedulableIssue> {
  /**
   * Index of {@link issue} in the underlying (flat) array that was used to create this tree.
   */
  index: number;

  /**
   * The issue corresponding to the current node.
   */
  issue: T;

  /**
   * The parent of the the current issue node, or `undefined` if this node is a root node.
   */
  parent?: IssueNode<T>;

  /**
   * Children of the current issue node.
   */
  children: IssueNode<T>[];

  /**
   * Dependencies of the current issue node.
   */
  dependencies: IssueNode<T>[];

  /**
   * Dependents of the current issue node.
   */
  dependents: IssueNode<T>[];
}

/**
 * An issue activity with one or more assignees.
 *
 * See {@link IssueActivity} and {@link groupByIntervalAndWaitStatus}().
 */
export interface MultiAssigneeIssueActivity extends Omit<IssueActivity, 'assignee'> {
  /**
   * Assignees for this issue activity, during the time interval from {@link IssueActivity.start} to
   * {@link IssueActivity.end}.
   *
   * The same guarantees hold as for {@link IssueActivity.assignee}. Additionally, the array is non-empty.
   */
  assignees: string[];
}

/**
 * Callback for progress updates.
 *
 * @param ProgressCallback.percentageDone progress in percent; that is, a number (not necessarily integer) between
 *     0 and 100
 */
export type ProgressCallback = (percentageDone: number) => void;

/**
 * A project plan.
 *
 * A project plan contains the current status of the issues in a YouTrack saved search. Additionally, it may also
 * contain the past project schedule reconstructed from the YouTrack activity log, and the future schedule computed from
 * YouTrack issue metadata plus the list of available contributors.
 */
export interface ProjectPlan {
  /**
   * Issues and their computed scheduling.
   */
  issues: YouTrackIssue[];

  /**
   * Warnings that may indicate incomplete or invalid data in YouTrack.
   */
  warnings: ProjectPlanWarning[];
}

/**
 * A warning concerning a project plan.
 */
export interface ProjectPlanWarning {
  /**
   * Human-readable warning message that can be displayed to the user.
   */
  description: string;

  /**
   * Issue identifier if the warning pertains to a specific issue, otherwise undefined.
   */
  issueId?: string;
}

/**
 * Options for retrieving YouTrack issue data and building a project plan.
 */
export interface RetrieveProjectPlanOptions {
  /**
   * Callback for progress updates.
   *
   * By default, there is no callback.
   */
  progressCallback?: ProgressCallback;

  /**
   * Whether issue activities should be omitted, in which case {@link YouTrackIssue.issueActivities} will be the empty
   * array for all issues.
   *
   * Retrieving past issue activities is the most time-consuming part of reconstructing a project plan. If the activity
   * information is not required, this option should therefore be set to `true`.
   *
   * By default, this is `false`; that is, issue activities *are* retrieved.
   */
  omitIssueActivities?: boolean;

  /**
   * Interval (in milliseconds) in which progress updates will be provided to the callback.
   *
   * By default, this is 200 milliseconds.
   */
  progressUpdateIntervalMs?: number;

  /**
   * Number of elements per HTTP request to array resources. See also {@link httpGetAll}().
   *
   * By default, this is 100.
   */
  restBatchSize?: number;
}

/**
 * An issue that can be scheduled.
 *
 * This interface contains all issue information relevant to its (future) scheduling.
 */
export interface SchedulableIssue {
  /**
   * Identifier.
   *
   * This corresponds to property `idReadable` of YouTrack REST API entity
   * [Issue](https://www.jetbrains.com/help/youtrack/standalone/api-entity-Issue.html).
   */
  id: string;

  /**
   * The remaining ideal time (aka effort) for this issue, in milliseconds.
   *
   * The ideal time is relative to the regular work time. It *does not* include time for subissues. If this issue is a
   * parent issue, this number is therefore typically different from the corresponding property stored in the issue
   * tracker (where, by assumption, the remaining effort required for subissues *is* included in the remaining effort of
   * the parent issue). If, in the issue tracker, the remaining effort is less than the total remaining effort of all
   * subissues, the property in this interface is 0 (it is *never* negative).
   */
  remainingEffortMs: number;

  /**
   * The remaining wait time for this issue, in milliseconds.
   *
   * The wait time is relative to the regular work time. For example, if the regular work time is 40h/week, and the
   * wait time is 16h, then this is 2 days in real time. This number is independent of the wait time of any subissues.
   * (And it would *not* make sense to configure the issue tracker to sum or otherwise aggregate the wait time of
   * subissues.)
   *
   * By default, there is no remaining wait time; that is, this property is 0.
   */
  remainingWaitTimeMs?: number;

  /**
   * Issue identifier (see {@link id}) of the parent issue.
   *
   * By default, the issue has no parent; that is, this property is the empty string.
   */
  parent?: string;

  /**
   * Whether this issue can be split across more than one person.
   *
   * By default, this is false.
   */
  splittable?: boolean;

  /**
   * Identifiers (see {@link id}) of the issues that this issue depends on.
   *
   * This includes only dependencies that are known.
   *
   * By default, there are no dependencies.
   */
  dependencies?: string[];

  /**
   * YouTrack-internal ID of the current assignee (YouTrack REST API entity name
   * [User](https://www.jetbrains.com/help/youtrack/standalone/api-entity-User.html)), or empty string if none.
   */
  assignee?: string;
}

/**
 * A schedule for issues with remaining effort or wait time.
 */
export type Schedule = ScheduledIssue[];

/**
 * Scheduled activities for an issue with remaining effort or wait time.
 *
 * The same guarantees hold as for {@link YouTrackIssue.issueActivities}.
 */
export type ScheduledIssue = IssueActivity[];

/**
 * Options for scheduling issues with remaining effort or wait time.
 *
 * It’s important to distinguish:
 * - Elapsed time (aka duration). [Cohn (2006, “Agile Estimating and Planning”)](http://www.worldcat.org/oclc/935197594)
 *   defines this as “the amount of time that passes on a clock (or perhaps a calendar).”
 * - Ideal time (aka effort or work). This, in contrast, is the “amount of time that something takes when stripped of
 *   all peripheral activities” (ibid.). Ideal time also does not contain time off work (such as nights or weekend).
 *
 * It is further important to define whether a quantity is given relative to the:
 * - actual work time of a contributor (say, 20h/week in case of part-time),
 * - regular work time (say, 40h/week), or
 * - real time (aka elapsed or wall-clock time; that is, 7 * 24h/week).
 *
 * In practice, this usually only affects the conversion factors between hours and days (say, 8h/d or 24h/d), and
 * between days and weeks (say, 5d/week vs. 7d/week).
 *
 * Finally, there are different options for mapping from work time to real time:
 * - Using the contributors’s work schedule (say, Monday through Friday, between 9am and 5pm) as a step function. No
 *   activity is scheduled outside these time windows.
 * - Interpolation. Here, the simplified assumption is that work time is evenly distributed over the entire real week.
 *   While this choice is arguably less realistic, it has the benefit of simplicity, and is often still sufficient for
 *   estimation purposes.
 *
 * In this module, in the absence of further qualification, elapsed time is meant relative to real time (24h/d and
 * 7d/week), and ideal time is meant relative to regular work time (which is
 * [configurable in YouTrack](https://www.jetbrains.com/help/youtrack/standalone/resource-api-admin-timeTrackingSettings-workTimeSettings.html)).
 * This module uses interpolation to convert from work time to real time. (The ceiling function is used for any integer
 * conversion.)
 */
export interface SchedulingOptions {
  /**
   * Contributors between whom all work will be allocated.
   */
  contributors: Contributor[];

  /**
   * The number of minutes in a work week.
   *
   * This number defines the conversion factor between regular work time (say, 40h/week) and real time (7 * 24h/week).
   *
   * By default, this is 5d * 8h/d * 60min/h = 2400min.
   */
  minutesPerWeek?: number;

  /**
   * Resolution (in milliseconds) of the computed schedule. More precisely, the duration of one quantum (unit) of
   * regular work time.
   *
   * The effect of this property is a quantization of time. Specifically, any elapsed time *relative to regular work
   * time* is always a multiple of this setting.
   *
   * By default, this is 1 hour; that is, 3,600,000ms.
   */
  resolutionMs?: number;

  /**
   * Minimum ideal time (in multiples of {@link resolutionMs}) that each issue activity must have in order
   * for the issue to be preemptable or splittable across more than one person.
   *
   * By default, this is 1.
   */
  minActivityDuration?: number;

  /**
   * Timestamp of the earliest point in time when unresolved issues with remaining effort or wait time can be scheduled.
   *
   * By default, the current time returned by `Date.now()` will be used.
   */
  predictionStartTimeMs?: number;
}

/**
 * Configuration of YouTrack.
 *
 * This defines the meaning of the
 * [YouTrack custom fields](https://www.jetbrains.com/help/youtrack/standalone/Custom-Fields.html) that pertain to
 * reconstructing a project plan from the activity log.
 */
export interface YouTrackConfig {
  /**
   * YouTrack-internal ID of the custom field (YouTrack REST API entity name
   * [CustomField](https://www.jetbrains.com/help/youtrack/standalone/api-entity-CustomField.html)) that contains the
   * state of an issue.
   *
   * The [field type](https://www.jetbrains.com/help/youtrack/standalone/Supported-Custom-Field-Types.html) must be
   * `state`.
   */
  stateFieldId: string;

  /**
   * YouTrack-internal IDs of the unresolved states (YouTrack REST API entity name
   * [StateBundleElement](https://www.jetbrains.com/help/youtrack/standalone/api-entity-StateBundleElement.html)) that
   * should be considered inactive (that is, not being worked on).
   */
  inactiveStateIds: string[];

  /**
   * YouTrack-internal ID of the custom field that contains the remaining effort of an issue.
   */
  remainingEffortFieldId?: string;

  /**
   * YouTrack-internal ID of the custom field that contains the remaining wait time of an issue.
   */
  remainingWaitFieldId?: string;

  /**
   * YouTrack-internal ID of the custom field (YouTrack REST API entity name
   * [CustomField](https://www.jetbrains.com/help/youtrack/standalone/api-entity-CustomField.html)) that contains the
   * assignee of an issue.
   *
   * The [field type](https://www.jetbrains.com/help/youtrack/standalone/Supported-Custom-Field-Types.html) must be
   * `user[1]`.
   */
  assigneeFieldId?: string;

  /**
   * Array of IDs of custom fields whose value should be included in the result.
   *
   * The values of these custom fields will be reported in {@link YouTrackIssue.customFields}. Currently, only
   * single-value enum custom fields are supported. If an issue has no value for the custom field type (or a value that
   * is not a single-value enum), the property will not be set in the result.
   */
  otherCustomFieldIds?: string[];

  /**
   * YouTrack-internal ID of the issue link type (YouTrack REST API entity name
   * [IssueLinkType](https://www.jetbrains.com/help/youtrack/standalone/api-entity-IssueLinkType.html)) that
   * establishes a finish-to-start dependency.
   *
   * Property {@link doesInwardDependOnOutward} determines the direction of the link type.
   */
  dependsLinkTypeId: string;

  /**
   * Whether the issue on the inward (target) side of the connection identified by {@link dependsLinkTypeId} depends on
   * the issue on the outward (source) side.
   *
   * If this property is false, then it is the other way round.
   *
   * By default, this is true (which corresponds to the
   * [YouTrack default setting](https://www.jetbrains.com/help/youtrack/standalone/Link-Issues.html) for the “Depend”
   * issue link type).
   */
  doesInwardDependOnOutward?: boolean;

  /**
   * YouTrack-internal ID of the saved search whose issues will be retrieved.
   *
   * The order of the issues in the saved search is significant, as the list scheduling algorithm depends on it. Field
   * {@link overlaySavedQueryId} can be used to override the order for a subset of the issues.
   *
   * Note that {@link ProjectPlan.issues} will follow the order of {@link savedQueryId} (with overlay).
   */
  savedQueryId: string;

  /**
   * YouTrack-internal ID of the saved search that contains an overlay order for a subset of the issues.
   *
   * As an example, suppose the issues in {@link savedQueryId} are A, B, C, D (in that order), and the issues in
   * {@link overlaySavedQueryId} are F, D, E, B. In this case, issues E and F are ignored (because they are not
   * contained in {@link savedQueryId}). The remaining issues B and D must appear in the overlay order, but any issue
   * not in {@link overlaySavedQueryId} must be left in place. Consequently, the final order for the algorithm (and
   * also in the output {@link ProjectPlan.issues}) is A, D, C, B.
   */
  overlaySavedQueryId?: string;

  /**
   * Duration (in milliseconds) below which a state change from active to inactive and back (or vice versa) is removed.
   *
   * For example, if `minStateChangeDurationMs` is 301, and the activity logs show that an issue was worked on between
   * timestamp 100 and 400, and then again between timestamp 700 to 1000, then only one active period from 100 to 1000
   * will actually be reported. On the other hand, if `minStateChangeDurationMs` is 901, then no active periods would be
   * reported. If there is ambiguity whether to remove an inactive or active phase (as in the example), the inactive
   * phase is removed.
   */
  minStateChangeDurationMs?: number;

  /**
   * The remaining effort (in milliseconds) for an unresolved issue where the custom field identified by
   * {@link YouTrackConfig.remainingEffortFieldId} has no value.
   *
   * If the remaining effort for an issue has no value, a warning will be added to {@link ProjectPlan.warnings}.
   *
   * By default (if this property is undefined), this is 0.
   */
  defaultRemainingEffortMs?: number;

  /**
   * The remaining wait time (in milliseconds) for an unresolved issue where the custom field identified by
   * {@link YouTrackConfig.remainingWaitFieldId} has no value.
   *
   * If the remaining wait time for an issue has no value, a warning will be added to {@link ProjectPlan.warnings}.
   *
   * By default (if this property is undefined), this is 0.
   */
  defaultWaitTimeMs?: number;

  /**
   * User-defined function that determines whether a given YouTrack issue is splittable across multiple persons.
   *
   * The function must not modify the issue given as argument.
   *
   * By default, no issue is splittable across multiple persons.
   *
   * @param issue the YouTrack issue
   * @return whether the given issue is splittable
   */
  isSplittableFn?(issue: YouTrackIssue): boolean;
}

/**
 * A YouTrack issue and its scheduling.
 *
 * Timestamps are in milliseconds since January 1, 1970 00:00:00 UTC.
 *
 * Note that this interface inherits from Required<{@link SchedulableIssue}> (unfortunately, TypeDoc is unable to
 * interpret the extends clause of this class).
 */
export interface YouTrackIssue extends Required<SchedulableIssue> {
  /**
   * The issue summary (that is, title).
   */
  summary: string;

  /**
   * Issue activities; that is, periods in which the issue is active/scheduled.
   *
   * The activities are sorted by {@link IssueActivity.end}. If there are several issue activities with the same end
   * timestamp but different assignees, the order among them is undefined (though deterministic). Issue activities with
   * the same assignee are guaranteed to not overlap (assuming each activity is a half-closed interval that excludes its
   * end timestamp). Moreover, if `a` and `b` are two activities with `a.assignee === b.assignee` and
   * `a.end === b.start`, then they differ in {@link IssueActivity.isWaiting}.
   *
   * It is guaranteed that activities representing wait time (where {@link IssueActivity.isWaiting} is true) do not
   * overlap with any other activities.
   *
   * Note that {@link groupByIntervalAndWaitStatus}() can be used if activities need to be grouped by interval.
   */
  issueActivities: IssueActivity[];

  /**
   * Timestamp when the issue was resolved, or `Number.MAX_SAFE_INTEGER` if it is unresolved.
   *
   * If an issue is resolved, then the inherited properties {@link SchedulableIssue.remainingEffortMs} and
   * {@link SchedulableIssue.remainingWaitTimeMs} are both 0 (irrespective of their actual values in YouTrack).
   */
  resolved: number;

  /**
   * YouTrack-internal ID of the current state of the issue (YouTrack REST API entity name
   * [StateBundleElement](https://www.jetbrains.com/help/youtrack/standalone/api-entity-StateBundleElement.html)), or
   * empty string if the state field is not set.
   */
  state: string;

  /**
   * Dictionary of custom field values.
   *
   * The keys in this dictionary are (possibly a subset of) the elements in
   * {@link YouTrackConfig.otherCustomFieldIds}. Each value is the ID of the enum bundle element (YouTrack REST API
   * entity name
   * [EnumBundleElement](https://www.jetbrains.com/help/youtrack/standalone/api-entity-EnumBundleElement.html)).
   * If an issue has no value for a custom field, the entry is omitted from the dictionary.
   */
  customFields: {[id: string]: string};
}
