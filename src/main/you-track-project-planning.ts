import { strict as assert } from 'assert';
import { Failure, ProgressCallback, ProjectPlan, YouTrackConfig, YouTrackIssue, } from './api-types';
import { OnlyOptionals } from './util';
import { httpGet, httpGetAll, httpGetAllWithOptions } from './you-track-http';
import * as RestApi from './you-track-rest';
import { CustomFieldActivityItem } from './you-track-rest';

/**
 * Retrieves, reconstructs, and returns a project plan consisting of the issues and their activities in a
 * [YouTrack saved search](https://www.jetbrains.com/help/youtrack/standalone/Saved-Search.html).
 *
 * This method requires that {@link handlePotentialOauthRedirect}() was called previously and obtained an OAuth token.
 * The authorization should be valid for the expected duration of the data retrieval. YouTrack
 * [does not](https://www.jetbrains.com/help/youtrack/standalone/OAuth-Authorization.html#AuthServerResponse) issue
 * refresh tokens, so communication with YouTrack will fail otherwise.
 *
 * @param baseUrl The YouTrack base URL. See also {@link httpGet}().
 * @param youTrackConfig configuration of YouTrack
 * @param progressCallback callback for status and progress updates
 * @param progressUpdateIntervalMs interval (in milliseconds) in which progress updates will be provided to the callback
 * @param restBatchSize Number of elements per HTTP request to array resources. See also {@link httpGetAll}().
 * @return A promise that in case of success will be fulfilled with a project plan. In case of any failure, it will be
 *     rejected with a {@link Failure}.
 */
export function reconstructProjectPlan(baseUrl: string, youTrackConfig: YouTrackConfig,
    progressCallback: ProgressCallback, progressUpdateIntervalMs: number = 200, restBatchSize: number = 100):
    Promise<ProjectPlan> {
  return new YouTrackIssueActivities(
      baseUrl, youTrackConfig, progressCallback, progressUpdateIntervalMs, restBatchSize
  ).promise;
}

/**
 * Retrieves and returns the number of minutes in a work week, as configured in YouTrack.
 *
 * @param baseUrl The YouTrack base URL. See also {@link httpGet}().
 * @return A promise that in case of success will be fulfilled with a the number of minutes. In case of any failure, it
 *     will be rejected with a {@link Failure}.
 */
export async function getMinutesPerWorkWeek(baseUrl: string): Promise<number> {
  const queryParams = {
    fields: YouTrackFields.WORK_TIME_SETTINGS,
  };
  const response: RestApi.WorkTimeSettings =
      await httpGet<RestApi.WorkTimeSettings>(baseUrl, RestApi.youTrackPath.WORK_TIME_SETTINGS, queryParams);
  return response.daysAWeek * response.minutesADay;
}

const YOUTRACK_CONFIG_DEFAULTS: OnlyOptionals<YouTrackConfig> = {
  remainingEffortFieldId: '',
  remainingWaitFieldId: '',
  assigneeFieldId: '',
  otherCustomFieldIds: [],
  doesInwardDependOnOutward: true,
  overlaySavedQueryId: '',
  minStateChangeDurationMs: 0,
  defaultRemainingEffortMs: 0,
  defaultWaitTimeMs: 0,
  isSplittableFn: () => false,
};

const YOUTRACK_CUSTOM_FIELDS_CATEGORY = 'CustomFieldCategory';

/**
 * YouTrack REST API fields.
 */
const enum YouTrackFields {
  SORTED_ISSUES = 'count',
  CUSTOM_FIELD = 'fieldDefaults(bundle(id))',
  STATE_BUNDLES = 'id,values(id,name,isResolved)',
  SAVED_QUERY_NAME = 'name',
  ISSUES = 'created,customFields(projectCustomField(field(id)),value(id,minutes,name)),id,idReadable,' +
      'links(direction,issues(id,idReadable),linkType(id)),parent(issues(id,idReadable)),resolved,' +
      'subtasks(issues(id,idReadable)),summary,updated',
  OVERLAY_ORDER = 'id',
  ACTIVITIES_PAGE = 'afterCursor,hasAfter,activities(added(id,name,isResolved),field(id),' +
      'removed(id,name,isResolved),target(id),timestamp)',
  WORK_TIME_SETTINGS = 'minutesADay,daysAWeek',
}

const enum ActiveState {
  UNKNOWN,
  ACTIVE,
  INACTIVE,
}

interface StateTransition {
  timestamp: number;
  activeState: ActiveState;
}

interface IssueId {
  /**
   * The human readable ID, consisting of project abbreviation and number.
   */
  id: string;

  /**
   * The YouTrack-internal ID.
   */
  internalId: string;
}

interface InternalYouTrackIssue extends YouTrackIssue {
  internalId: string;
  parentIssueId: IssueId | null;
  subtaskIssueIds: IssueId[];
  dependencyIssueIds: IssueId[];
  activeState: ActiveState;
  stateTransitions: StateTransition[];
  lastUpdate?: number;
}

/**
 * Class that retrieves issues, their state changes, and issue links.
 */
class YouTrackIssueActivities {
  public readonly promise: Promise<ProjectPlan>;

  private readonly baseUrl_: string;
  private readonly config_: Required<YouTrackConfig>;
  private readonly progressCallback_: ProgressCallback;
  private readonly progressUpdateIntervalMs_: number;
  private readonly restBatchSize_: number;
  private readonly dependsOnDirection_: 'INWARD' | 'OUTWARD';
  private readonly issues_: InternalYouTrackIssue[] = [];
  private readonly idToIssueMap_ = new Map<string, InternalYouTrackIssue>();
  private readonly idToActiveState_: {[id: string]: ActiveState} = {};
  private readonly lowerCaseNameToActiveState_: {[lowerCaseName: string]: ActiveState} = {};
  private readonly projectPlan_: ProjectPlan;

  private numIssues_: number = 0;
  private savedQueryName_: string = '';
  private numTasksWithDetails_: number = 0;
  private minTimeStamp_: number = 0;
  private maxUpdateTimeStamp_: number = 0;
  private maxActivityTimeStamp_: number = 0;
  private lastProgressUpdate_: number = 0;

  /**
   * Constructor that will already start the communication with the YouTrack server.
   */
  constructor(baseUrl: string, youTrackConfig: YouTrackConfig, progressCallback: ProgressCallback,
      progressUpdateIntervalMs: number, restBatchSize: number) {
    this.baseUrl_ = baseUrl;
    this.config_ = {...YOUTRACK_CONFIG_DEFAULTS, ...youTrackConfig};
    this.progressCallback_ = progressCallback;
    this.progressUpdateIntervalMs_ = progressUpdateIntervalMs;
    this.restBatchSize_ = restBatchSize;
    this.dependsOnDirection_ = this.config_.doesInwardDependOnOutward ? 'INWARD' : 'OUTWARD';
    this.projectPlan_ = {
      issues: [],
      warnings: [],
    };
    this.promise = this.run();
  }

  private async run(): Promise<ProjectPlan> {
    await this.retrieveNumIssues();
    const stateBundleId: string = await this.getStateBundleId();
    await this.retrieveSavedQueryName();
    await this.buildIdToActiveStateMap(stateBundleId);
    this.progressUpdate();
    await this.retrieveIssues();
    await this.retrieveOverlayOrder();
    await this.retrieveActivities();
    this.finalizeSchedule();
    return this.projectPlan_;
  }

  /**
   * If sufficient time has elapsed since the last progress update, send a new message to the thread that spawned this
   * worker.
   */
  private progressUpdate(): void {
    if (Date.now() - this.lastProgressUpdate_ < this.progressUpdateIntervalMs_) {
      return;
    }

    let percentageDone = 0;
    if (this.numIssues_ > 0) {
      percentageDone =
        1 +
        9 * Math.min(1, this.numTasksWithDetails_ / this.numIssues_);
      if (this.minTimeStamp_ > 0) {
        percentageDone += 90 * Math.min(1,
          (this.maxActivityTimeStamp_ - this.minTimeStamp_) / (this.maxUpdateTimeStamp_ - this.minTimeStamp_)
        );
      }
    }

    this.lastProgressUpdate_ = Date.now();
    this.progressCallback_(percentageDone);
  }

  private newHttpRequest<T>(resourcePath: string, queryParams: {[param: string]: string}): Promise<T> {
    return httpGet(this.baseUrl_, resourcePath, queryParams);
  }

  private getAll<T>(resourcePath: string, queryParams: {[param: string]: string},
        processBatch: (batch: T[]) => void): Promise<void> {
    return httpGetAllWithOptions(this.baseUrl_, resourcePath, queryParams, this.restBatchSize_,
        processBatch, undefined);
  }

  private async retrieveNumIssues(): Promise<void> {
    const queryParams = {
      folderId: this.config_.savedQueryId,
      fields: YouTrackFields.SORTED_ISSUES,
    };
    const response: RestApi.SortedIssuesResponse =
        await this.newHttpRequest(RestApi.youTrackPath.SORTED_ISSUES, queryParams);
    this.numIssues_ = response.count;
  }

  private async getStateBundleId(): Promise<string> {
    const queryParams = {fields: YouTrackFields.CUSTOM_FIELD};
    const customField: RestApi.CustomField =
        await this.newHttpRequest(RestApi.youTrackPath.CUSTOM_FIELD(this.config_.stateFieldId), queryParams);
    return (customField.fieldDefaults as RestApi.StateBundleCustomFieldDefaults).bundle.id;
  }

  private async retrieveSavedQueryName(): Promise<void> {
    const queryParams = {fields: YouTrackFields.SAVED_QUERY_NAME};
    const savedQuery: RestApi.SavedQuery =
        await this.newHttpRequest(RestApi.youTrackPath.SAVED_QUERY(this.config_.savedQueryId), queryParams);
    this.savedQueryName_ = savedQuery.name;
  }

  private async buildIdToActiveStateMap(stateBundleId: string): Promise<void> {
    const queryParams: {fields: string} = {
      fields: YouTrackFields.STATE_BUNDLES,
    };
    await this.getAll<RestApi.StateBundle>(RestApi.youTrackPath.STATE_BUNDLES, queryParams, (restStateBundles) => {
      for (const restStateBundle of restStateBundles) {
        const isRelevantStateBundle = restStateBundle.id === stateBundleId;
        for (const restElement of restStateBundle.values) {
          if (restElement.isResolved || this.config_.inactiveStateIds.includes(restElement.id)) {
            this.idToActiveState_[restElement.id] = ActiveState.INACTIVE;
          } else if (isRelevantStateBundle) {
            this.idToActiveState_[restElement.id] = ActiveState.ACTIVE;
          }

          if (isRelevantStateBundle) {
            this.lowerCaseNameToActiveState_[restElement.name.toLowerCase()] = this.idToActiveState_[restElement.id];
          }
        }
      }
    });
  }

  private parseIssueCustomFields(issue: InternalYouTrackIssue, restIssue: RestApi.Issue): void {
    for (const customField of restIssue.customFields) {
      const fieldId = customField.projectCustomField.field.id;
      switch (fieldId) {
        case this.config_.remainingEffortFieldId:
          if (RestApi.isPeriodIssueCustomField(customField) && customField.value !== null) {
            issue.remainingEffortMs = customField.value.minutes * 60 * 1000;
          }
          break;
        case this.config_.remainingWaitFieldId:
          if (RestApi.isPeriodIssueCustomField(customField) && customField.value !== null) {
            issue.remainingWaitTimeMs = customField.value.minutes * 60 * 1000;
          }
          break;
        case this.config_.assigneeFieldId:
          if (RestApi.isSingleUserIssueCustomField(customField) && customField.value !== null) {
            issue.assignee = customField.value.id;
          }
          break;
        case this.config_.stateFieldId:
          if (RestApi.isStateIssueCustomField(customField) && customField.value !== null) {
            issue.state = customField.value.id;
            issue.activeState = this.stateBundleElementIdToActiveState(customField.value);
          }
          break;
        default:
          if (RestApi.isSingleEnumIssueCustomField(customField) &&
              customField.value !== null &&
              this.config_.otherCustomFieldIds.find((id) => id === fieldId)) {
            issue.customFields[fieldId] = customField.value.id;
          }
      }
    }
  }

  private async retrieveIssues(): Promise<void> {
    const queryParams = {fields: YouTrackFields.ISSUES};
    await this.getAll<RestApi.Issue>(
        RestApi.youTrackPath.ISSUES(this.config_.savedQueryId), queryParams, (restIssues) => {
          for (const restIssue of restIssues) {
            const issue: InternalYouTrackIssue = {
              id: restIssue.idReadable,
              remainingEffortMs: this.config_.defaultRemainingEffortMs,
              remainingWaitTimeMs: this.config_.defaultWaitTimeMs,
              splittable: false,
              dependencies: [],
              assignee: '',

              summary: restIssue.summary,
              issueActivities: [],
              resolved: restIssue.resolved !== null
                  ? restIssue.resolved
                  : Number.MAX_SAFE_INTEGER,
              state: '',
              parent: '',
              customFields: {},

              internalId: restIssue.id,
              parentIssueId: restIssue.parent.issues.length > 0
                  ? {
                      id: restIssue.parent.issues[0].idReadable,
                      internalId: restIssue.parent.issues[0].id,
                    }
                  : null,
              subtaskIssueIds: restIssue.subtasks.issues.map((subissue) => ({
                id: subissue.idReadable,
                internalId: subissue.id,
              })),
              dependencyIssueIds: [],
              activeState: ActiveState.UNKNOWN,
              stateTransitions: [{timestamp: restIssue.created, activeState: ActiveState.UNKNOWN}],
              lastUpdate: restIssue.updated,
            };
            this.issues_.push(issue);
            this.idToIssueMap_.set(restIssue.id, issue);

            this.parseIssueCustomFields(issue, restIssue);

            for (const restLink of restIssue.links) {
              if (restLink.direction === this.dependsOnDirection_ &&
                  restLink.linkType.id === this.config_.dependsLinkTypeId) {
                issue.dependencyIssueIds.push(...restLink.issues.map((linkedIssue) => ({
                  id: linkedIssue.idReadable,
                  internalId: linkedIssue.id,
                })));
              }
            }

            ++this.numTasksWithDetails_;
            this.maxUpdateTimeStamp_ = Math.max(this.maxUpdateTimeStamp_, restIssue.updated);
          }
          this.progressUpdate();
        }
    );
  }

  private async retrieveOverlayOrder(): Promise<void> {
    if (this.config_.overlaySavedQueryId.length === 0) {
      return;
    }

    const queryParams = {fields: YouTrackFields.OVERLAY_ORDER};
    type IdIssue = Pick<RestApi.Issue, 'id'>;
    const issues = await httpGetAll<IdIssue>(this.baseUrl_,
        RestApi.youTrackPath.ISSUES(this.config_.overlaySavedQueryId), queryParams, this.restBatchSize_);
    const overlayIds = issues.map((issue) => issue.id).filter((id) => this.idToIssueMap_.has(id));
    const idToOverlayIdx = overlayIds.reduce((map, id, idx) => map.set(id, idx), new Map<string, number>());

    let issueIdx = 0;
    let overlayIdx = 0;
    while (issueIdx < this.issues_.length && overlayIdx < overlayIds.length) {
      const issue: InternalYouTrackIssue = this.issues_[issueIdx];
      if (idToOverlayIdx.has(issue.internalId)) {
        this.issues_[issueIdx] = this.idToIssueMap_.get(overlayIds[overlayIdx])!;
        ++overlayIdx;
      }
      ++issueIdx;
    }
  }

  private async retrieveActivities(): Promise<void> {
    const queryParams: {[param: string]: string} = {
      fields: YouTrackFields.ACTIVITIES_PAGE,
      categories: YOUTRACK_CUSTOM_FIELDS_CATEGORY,
      issueQuery: `saved search: {${this.savedQueryName_}}`,
      $top: this.restBatchSize_.toString(),
    };
    let busy = true;
    let promise = this.newHttpRequest<RestApi.ActivityCursorPage>(RestApi.youTrackPath.ACTIVITIES_PAGE, queryParams);
    do {
      const activitiesPage = await promise;
      if (activitiesPage.hasAfter) {
        queryParams.cursor = activitiesPage.afterCursor!;
        promise = this.newHttpRequest<RestApi.ActivityCursorPage>(RestApi.youTrackPath.ACTIVITIES_PAGE, queryParams);
      } else {
        busy = false;
      }
      // The type-cast is fine because we set queryParams.categories accordingly.
      this.parseActivityItems(activitiesPage.activities as CustomFieldActivityItem[]);
      this.progressUpdate();
    } while (busy);
  }

  private stateBundleElementIdToActiveState(
      arrayOrObject?: RestApi.StateBundleElement | RestApi.StateBundleElement[]): ActiveState {
    let object: RestApi.StateBundleElement | undefined;
    if (arrayOrObject instanceof Array) {
      object = arrayOrObject.length > 0 ? arrayOrObject[0] : undefined;
    } else {
      object = arrayOrObject;
    }

    if (object === undefined) {
      return ActiveState.UNKNOWN;
    }

    if (object.isResolved) {
      return ActiveState.INACTIVE;
    } else if (object.id in this.idToActiveState_) {
      return this.idToActiveState_[object.id];
    }

    const lowerCaseName = object.name.toLowerCase();
    if (lowerCaseName in this.lowerCaseNameToActiveState_) {
      return this.lowerCaseNameToActiveState_[lowerCaseName];
    }
    return ActiveState.UNKNOWN;
  }

  private addStateTransition(stateTransitions: StateTransition[], newStateTransition: StateTransition,
      replacementForPreviousUnknown: ActiveState): void {
    const a = stateTransitions;
    let n = a.length;
    const c = this.config_.minStateChangeDurationMs;
    // By definition, a is the array [a[0], ..., a[n - 1]]. With the abbreviating notation a[i].s ∈ {A,I,U} and
    // a[i].t (instead of a[i].activeState and a[i].timestamp, respectively), if the following invariants hold here
    // then they also hold when the function returns.
    // (And the fact that the invariant holds the first time this method is called follows from method retrieveIssues().
    // There, the array a was initialized with exactly one element such that a[0].s = U.)
    // Throughout the explanatory comments, let n denote the length of a (even at the end of the function where the
    // source code does not reassign n).
    //
    // 1. a[0].s, ..., a[n - 2].s ∈ {A,I}.
    // 2. a[i - 1].s != a[i].s for all i = 1, ..., n - 1
    // 3. n = 1 => (a[0].s ∈ {A,U} and n > 1 => a[0].s = A)
    // 4. a[i - 1].t < a[i].t for all i = 1, ..., n - 1
    // 5. a[i].t - a[i - 1].t >= c for all i = 1, ..., n - 3
    // 6. a[n - 2].t - a[n - 3].t < c => (a[n - 1].t - a[n - 2].t < c and a[n - 2].s = I and a[n - 1].s = U)
    // 7. a[n - 1].t - a[n - 2].t < c => a[n - 1].s ∈ {I,U}

    // In the following, we first prepare a so that newStateTransition could be added without violating the
    // invariants. Let s ∈ {A,I,U} denote the new state and t the new timestamp. That is,
    // s = newStateTransition.activeState and t = newStateTransition.timestamp.

    // The behavior of this function satisfies (with a and n denoting the respective values upon return, and a' and n'
    // their current values, respectively):
    // I. a[i].t - a[i-1].t < c => t - a[i].t < c
    // II. (a'[n - 1].s ∈ {A,I} and s != a'[n - 1].s and t >= a'[n - 1].t + c)
    //     => (a' = a[0 .. n - 2] and a[n - 1] = (t, s))

    // Goal: Preserve invariant 4.
    while (n > 0 && a[n - 1].timestamp >= newStateTransition.timestamp) {
      a.pop();
      --n;
    }
    // (Condition POST-WHILE:) We now have a[n - 1].t <= t. Also, all invariants hold.

    // Goal: Preserve invariant 1.
    if (n > 0 && a[n - 1].activeState === ActiveState.UNKNOWN) {
      a[n - 1].activeState = replacementForPreviousUnknown !== ActiveState.UNKNOWN
          ? replacementForPreviousUnknown
          : ActiveState.ACTIVE;
      // We now have (stronger than invariant 1!): a[0].s, ..., a[n - 1].s ∈ {A,I}.
      //
      // Goals:
      // - Restore invariant 3 (if-condition before '||')
      // - Restore invariant 2 (if-condition after '||')
      // - Preserve invariant 5,6,7 (else-if-condition)
      if ((n === 1 && a[0].activeState === ActiveState.INACTIVE) ||
          (n > 1 && a[n - 1].activeState === a[n - 2].activeState)) {
        a.pop();
        --n;
      } else if (n > 2 && a[n - 2].activeState === ActiveState.INACTIVE &&
          a[n - 2].timestamp - a[n - 3].timestamp < c) {
        // Note we have here: a[n - 1].s = A.
        a.length -= 2;
        n -= 2;
        // We now have a[i].t - a[i - 1].t >= c for all i. Also, a[n - 1].s = A.
      }
    }
    // (Condition NOUNKNOWN:) All invariants hold, and additionally a[n - 1].s ∈ {A,I} and a[i].t - a[i - 1].t >= c
    // for i = 1, ..., n - 2.

    // Goal: Preserve invariants 5,6,7.
    if (n > 1 && a[n - 1].activeState === ActiveState.INACTIVE &&
        a[n - 1].timestamp - a[n - 2].timestamp < c &&
        newStateTransition.timestamp - a[n - 1].timestamp >= c) {
      a.length -= 2;
      n -= 2;
    }
    // (Condition GAPS1:) All invariants hold. It also holds now that (a[n - 1].t - a[n - 2].t < c) implies that the
    // previous if-block was not entered (because 2 elements were removed from the list and therefore
    // condition NOUNKNOWN would imply a[n - 1].t - a[n - 2].c >= c). Therefore one of the following holds:
    // (1.) a[n - 1].s ∈ {A,U}, which together with condition NOUNKNOWN implies a[n - 1].s = A, or
    // (2.) t - a[n - 1].t < c.

    // Goal: Preserve invariant 2.
    if (n > 0 && newStateTransition.activeState === a[n - 1].activeState) {
      // All invariants still hold (due to condition GAPS1).
      return;
    }
    // (Condition ALT:) All invariants hold. We also have now s != a[n - 1].s.

    // Goal: Preserve invariants 5,6,7.
    if (n > 1 && newStateTransition.activeState === ActiveState.ACTIVE &&
        newStateTransition.timestamp - a[n - 1].timestamp < c) {
      a.pop();
      // Since n > 1, we have (due to invariant 3) that a[0].s = A. Therefore, invariant 3 remains
      // valid. Other invariants trivially hold, because the last line cannot have invalidated them.
      return;
    }
    // (Condition GAPS2:) All invariants hold. We also have now that n > 1 implies that (1.) s ∈ {I,U} or
    // (2.) t - a[n - 1] >= c.

    // Goal: Preserve invariant 3.
    if (n > 0 || newStateTransition.activeState !== ActiveState.INACTIVE) {
      a.push(newStateTransition);
      // Let n = a.length (which changed in the last line).
      // - Invariant 1 continues to hold because of condition NOUNKNOWN.
      // - Invariant 2 continues to hold because of condition ALT.
      // - Regarding invariant 3, if n = 1, then a[0] = s ∈ {A,U} because of the if-condition. If n = 2, then
      //   a[0].s ∈ {A,U} due to invariant 3 holding before, and therefore a[0].s = A due to condition NOUNKNOWN.
      //   If n > 2, then a[0].s = A because invariant 3 held before the last line.
      // - Invariant 4 holds because a[n - 1].t <= t (due to condition POST-WHILE).
      // - Invariant 5 holds because of condition NOUNKNOWN.
      // - Regarding invariant 6, only the case n > 3 is meaningful (i.e., not a vacuous truth). Suppose that
      //   a[n - 2].t - a[n - 3].t < c. Since invariant 7 held before, we know a[n - 2].s ∈ {I,U}. Together with
      //   condition NOUNKNOWN, this implies a[n - 2].s = I. Condition GAPS2 implies a[n - 1].s = s ∈ {I,U}, and
      //   condition ALT strengthens this to a[n - 1].s = U. Finally, due to condition GAPS1 (note that
      //   a[n - 2].s ∉ {A,U}), we have a[n - 1].t - a[n - 2].t < c.
      // - Regarding invariant 7, suppose a[n - 1].t - a[n - 2].t < c. Then s ∈ {I,U} due to condition GAPS2.
    }
  }

  private parseActivityItems(activityItems: RestApi.CustomFieldActivityItem[]): void {
    if (activityItems.length > 0) {
      if (this.minTimeStamp_ === 0) {
        this.minTimeStamp_ = activityItems[0].timestamp;
      }
      this.maxActivityTimeStamp_ =
          Math.max(this.maxActivityTimeStamp_, activityItems[activityItems.length - 1].timestamp);
    }
    for (const activityItem of activityItems) {
      if (activityItem.field.id === this.config_.stateFieldId) {
        // In theory, multiple users can own saved queries with the same name, in which case we may see more issues here
        // than we need to.
        const issue = this.idToIssueMap_.get(activityItem.target.id);
        if (issue === undefined) {
          continue;
        }

        const newStateTransition = {
          timestamp: activityItem.timestamp,
          activeState: this.stateBundleElementIdToActiveState(activityItem.added as RestApi.StateBundleElement[]),
        };
        this.addStateTransition(issue.stateTransitions, newStateTransition,
            this.stateBundleElementIdToActiveState(activityItem.removed as RestApi.StateBundleElement[]));
      }
    }
  }

  private finalizeSchedule(): void {
    for (const issue of this.issues_) {
      // The following 3 issue properties have been set before in finishedIssues().
      const newStateTransition: StateTransition = {
        timestamp: issue.lastUpdate!,
        activeState: issue.activeState,
      };
      this.addStateTransition(issue.stateTransitions, newStateTransition, issue.activeState);
      // Using the definitions in addStateTransition(), we could at this point still have a[n - 1].s = U or
      // a[n - 1].t - a[n - 2].t < c. We therefore add the following final transition for "clean up".
      // Note that we err on the side of interpreting state UNKNOWN as ACTIVE.
      const finalStateTransition: StateTransition = {
        timestamp: Number.MAX_SAFE_INTEGER,
        activeState: issue.activeState === ActiveState.UNKNOWN
            ? ActiveState.ACTIVE
            : issue.activeState,
      };
      this.addStateTransition(issue.stateTransitions, finalStateTransition, ActiveState.ACTIVE);
      assert(
          issue.stateTransitions
              .filter((stateTransition) => stateTransition.activeState === ActiveState.UNKNOWN).length === 0,
          'issue.stateTransitions should no longer contain elements with activeState === ActiveState.UNKNOWN'
      );
      assert(
          issue.stateTransitions
              .map((stateTransition) => stateTransition.timestamp)
              .reduce(
                  ([min, previousTimestamp], timestamp) => [Math.min(min, timestamp - previousTimestamp), timestamp],
                  [Number.MAX_SAFE_INTEGER, -this.config_.minStateChangeDurationMs]
              )[0] >= this.config_.minStateChangeDurationMs,
          'issue.stateTransitions should no longer have consecutive elements within less than minStateChangeDurationMs'
      );

      const a = issue.stateTransitions;
      const n = a.length;
      for (let i = 0; i < n; i += 2) {
        issue.issueActivities.push({
          assignee: issue.assignee,
          start: a[i].timestamp,
          end: i < n - 1 ? a[i + 1].timestamp : Number.MAX_SAFE_INTEGER,
          isWaiting: false,
        });
      }

      let parent: string = '';
      if (issue.parentIssueId !== null) {
        if (this.idToIssueMap_.has(issue.parentIssueId.internalId)) {
          parent = issue.parentIssueId.id;
        } else {
          this.projectPlan_.warnings.push({
            description: `Issue ${issue.id} is a subtask of ${issue.parentIssueId.id}, which is not contained ` +
                `in saved search “${this.savedQueryName_}”.`,
            issueId: issue.id,
          });
        }
      }

      const dependencies: string[] = [];
      const unknownDependencies: string[] = [];
      for (const issueId of issue.dependencyIssueIds) {
        const pushTo = this.idToIssueMap_.has(issueId.internalId) ? dependencies : unknownDependencies;
        pushTo.push(issueId.id);
      }
      if (unknownDependencies.length > 0) {
        this.projectPlan_.warnings.push({
          description: `Issue ${issue.id} depends on ${unknownDependencies.join(', ')}, which is/are not ` +
              `contained in saved search “${this.savedQueryName_}”.`,
          issueId: issue.id,
        });
      }

      let remainingEffortMs = issue.resolved === Number.MAX_SAFE_INTEGER
          ? issue.remainingEffortMs
          : 0;
      const unknownSubtasks: string[] = [];
      for (const issueId of issue.subtaskIssueIds) {
        const subIssue: InternalYouTrackIssue | undefined = this.idToIssueMap_.get(issueId.internalId);
        if (subIssue !== undefined) {
          remainingEffortMs = Math.max(0, remainingEffortMs - subIssue.remainingEffortMs);
        } else {
          unknownSubtasks.push(issueId.id);
        }
      }
      if (unknownSubtasks.length > 0) {
        this.projectPlan_.warnings.push({
          description: `Issue ${issue.id} is a parent for ${unknownSubtasks.join(', ')}, which is/are not ` +
              `contained in saved search “${this.savedQueryName_}”.`,
          issueId: issue.id,
        });
      }

      const youTrackIssue: YouTrackIssue = {
        id: issue.id,
        summary: issue.summary,
        issueActivities: issue.issueActivities,
        resolved: issue.resolved,
        state: issue.state,
        assignee: issue.assignee,
        parent,
        customFields: issue.customFields,
        remainingEffortMs,
        remainingWaitTimeMs: issue.resolved === Number.MAX_SAFE_INTEGER
            ? issue.remainingWaitTimeMs
            : 0,
        splittable: issue.splittable,
        dependencies,
      };
      youTrackIssue.splittable = this.config_.isSplittableFn(youTrackIssue);
      this.projectPlan_.issues.push(youTrackIssue);
    }
  }
}
