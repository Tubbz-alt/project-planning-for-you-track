import { YouTrackConfig } from '../main';
import { assignDefined, OnlyOptionals } from '../main/util';
import {
  ActivityCursorPage,
  ActivityItem,
  CustomField,
  CustomFieldActivityItem,
  Issue,
  IssueCustomField,
  IssueLink,
  PeriodIssueCustomField,
  PeriodValue,
  SavedQuery,
  SingleEnumIssueCustomField,
  SingleUserIssueCustomField,
  SortedIssuesResponse,
  StateBundle,
  StateBundleElement,
  StateIssueCustomField,
  User,
  WorkTimeSettings,
  YouTrackError,
} from '../main/you-track-rest';
import { extractProperties, parseFieldsParameter } from '../spec/fields-parameters';

type DeepPartial<T> = {[P in keyof T]?: T[P] extends {[key: string]: any} ? DeepPartial<T[P]> : T[P]};

export interface YouTrackDataIssue {
  type?: string;
  states: ([number, string] | [number, string, string])[];
  par?: number | null;
  dep?: number[];
  effort?: number | null;
  wait?: number | null;
  assignee?: string;
  unknownSubissues?: number[];
}

export interface YouTrackData {
  coalesceBelowMs?: number;
  inactiveUnresolvedStates?: string[];
  resolvedStates?: string[];
  issues: YouTrackDataIssue[];
}

interface StrictYouTrackData extends Required<YouTrackData> {
  issues: Required<YouTrackDataIssue>[];
}

interface IssueId {
  id: string;
  idReadable: string;
}

interface InternalIssue {
  id: string;
  idReadable: string;
  summary: string;
  created: number;
  resolved: number | null;
  updated: number;

  dependsOn: IssueId[];
  isRequiredFor: IssueId[];
  subtaskOf: IssueId | null;
  parentFor: IssueId[];

  stateId: string;
  stateName: string;
  stateBundleId: string;
  typeId: string;
  assigneeId: string;
  remainingEffortMin: number | null;
  remainingWaitMin: number | null;
}

interface StringToStringDict {
  [name: string]: string;
}

// YouTrack also has BOTH, but the following is sufficient here.
type LinkDirection = 'INWARD' | 'OUTWARD';

declare global {
  // noinspection JSUnusedGlobalSymbols
  interface Array<T> {
    flatMap<U, This = undefined>(
      callback: (this: This, value: T, index: number, array: T[]) => U | ReadonlyArray<U>,
      thisArg?: This
    ): U[];
  }
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/flatMap says
// Array.prototype.flatMap is a relatively recent feature. But it's also very convenient. And this is just test code,
// we add a simple implementation here.
if (!Array.prototype.flatMap) {
  // Note: Cannot use arrow function because we need 'this'.
  Array.prototype.flatMap = function <T, U, This = undefined> (
      callback: (this: This, value: T, index: number, array: T[]) => U | ReadonlyArray<U>,
      thisArg?: This): U[] {
    return ([] as U[]).concat(...this.map(callback, thisArg));
  };
}

function newDefaultYouTrackData(): OnlyOptionals<YouTrackData> {
  return {
    coalesceBelowMs: 0,
    inactiveUnresolvedStates: [],
    resolvedStates: [],
  };
}

function newDefaultYouTrackDataIssue(): OnlyOptionals<YouTrackDataIssue> {
  return {
    type: '',
    par: null,
    dep: [],
    effort: null,
    wait: null,
    assignee: '',
    unknownSubissues: [],
  };
}

function stripStar(stateName: string): string {
  return stateName.charAt(0) === '*' ? stateName.slice(1) : stateName;
}

function youTrackConfigForData(data: StrictYouTrackData, nameToStateIdMap: StringToStringDict,
    sideOfDependsOn: LinkDirection): YouTrackConfig {
  return {
    stateFieldId: CUSTOM_FIELD_ID_STATE,
    inactiveStateIds: data.inactiveUnresolvedStates
        .map((stateName) => nameToStateIdMap[stateName]),
    remainingEffortFieldId: CUSTOM_FIELD_ID_REMAINING_EFFORT,
    remainingWaitFieldId: CUSTOM_FIELD_ID_REMAINING_WAIT,
    assigneeFieldId: CUSTOM_FIELD_ID_ASSIGNEE,
    otherCustomFieldIds: [CUSTOM_FIELD_ID_TYPE],
    dependsLinkTypeId: LINK_TYPE_ID_DEPENDS,
    doesInwardDependOnOutward: sideOfDependsOn === 'INWARD',
    savedQueryId: SAVED_QUERY_ID_BASE,
    overlaySavedQueryId: SAVED_QUERY_ID_OVERLAY,
    minStateChangeDurationMs: data.coalesceBelowMs,
  };
}

function stateBundlesFrom(mainBundleStates: DeepPartial<StateBundleElement>[],
    otherBundleStates: DeepPartial<StateBundleElement>[]): DeepPartial<StateBundle>[] {
  return [{
    $type: 'StateBundle',
    id: STATE_BUNDLE_ID_OTHER,
    values: otherBundleStates,
  }, {
    $type: 'StateBundle',
    id: STATE_BUNDLE_ID_MAIN,
    values: mainBundleStates,
  }] as StateBundle[];
}

function idxToIssueId(index: number): IssueId {
  return {
    id: ISSUE_ID(index),
    idReadable: ISSUE_READABLE_ID(index),
  };
}

function internalIssuesFromData(data: StrictYouTrackData, nameToStateIdMap: StringToStringDict) {
  const internalIssues: InternalIssue[] = data.issues
      .map((issue: Required<YouTrackDataIssue>, idx) => {
        const lastState = issue.states[issue.states.length - 1];
        return {
          ...idxToIssueId(idx),
          summary: ISSUE_SUMMARY(idx),
          created: issue.states[0][0],
          resolved: data.resolvedStates.includes(lastState[1]) ? lastState[0] : null,
          updated: lastState[0],

          dependsOn: issue.dep.map(idxToIssueId),
          isRequiredFor: [],
          subtaskOf: issue.par !== null ? idxToIssueId(issue.par) : null,
          parentFor: issue.unknownSubissues.map(idxToIssueId),

          stateId: nameToStateIdMap[lastState[1]],
          stateName: stripStar(lastState[1]),
          stateBundleId: lastState[1].charAt(0) === '*'
              ? STATE_BUNDLE_ID_OTHER
              : STATE_BUNDLE_ID_MAIN,
          typeId: issue.type,
          assigneeId: issue.assignee,
          remainingEffortMin: issue.effort,
          remainingWaitMin: issue.wait,
        };
      });
  for (let idx = 0; idx < data.issues.length; ++idx) {
    const issue: Required<YouTrackDataIssue> = data.issues[idx];
    for (const dependsOn of issue.dep) {
      if (dependsOn >= 0 && dependsOn < internalIssues.length) {
        internalIssues[dependsOn].isRequiredFor.push(idxToIssueId(idx));
      }
    }
    if (issue.par !== null && issue.par >= 0 && issue.par < internalIssues.length) {
      internalIssues[issue.par].parentFor.push(idxToIssueId(idx));
    }
  }
  return internalIssues;
}

function activitiesFromData(data: StrictYouTrackData, nameToStateIdMap: StringToStringDict):
    DeepPartial<CustomFieldActivityItem>[] {
  // Simulate some irrelevant activities that should be ignored.
  const irrelevantActivityItems: DeepPartial<CustomFieldActivityItem>[] = [{
    $type: 'CustomFieldActivityItem',
    added: [],
    removed: [],
    field: {
      id: CUSTOM_FIELD_ID_OTHER,
    },
    target: {
      $type: 'Issue',
      id: ISSUE_ID_OTHER,
    },
    timestamp: 1,
  }, {
    // An activity of this kind can arise because activities are retrieved for an issue query of form
    // "saved search: {name of saved search}". That is, we are not passing the ID of the saved search, but it's name,
    // which may not be unique.
    $type: 'CustomFieldActivityItem',
    added: [],
    removed: [],
    field: {
      id: CUSTOM_FIELD_ID_STATE,
    },
    target: {
      $type: 'Issue',
      id: ISSUE_ID_OTHER,
    },
    timestamp: 2,
  }];
  const relevantActivityItems: DeepPartial<CustomFieldActivityItem>[] = data.issues
      .flatMap(
          (issue, issueIndex) => issue.states.slice(1).map(
              ([timestamp, _], stateIndexMinus1) => ({issue, issueIndex, stateIndex: stateIndexMinus1 + 1, timestamp})
          )
      )
      .map(({issue, issueIndex, stateIndex, timestamp}) => {
        const currentState = issue.states[stateIndex];
        const currentStateName = currentState[1];
        let previousStateName;
        if (currentState.length === 3) {
          previousStateName = currentState[2];
        } else {
          previousStateName = issue.states[stateIndex - 1][1];
        }
        return {
          $type: 'CustomFieldActivityItem',
          added: currentStateName === '' ? [] : [{
            id: nameToStateIdMap[currentStateName],
            name: stripStar(currentStateName),
            isResolved: data.resolvedStates.includes(currentStateName),
          } as StateBundleElement],
          field: {
            id: CUSTOM_FIELD_ID_STATE,
          },
          removed: previousStateName === '' ? [] : [{
            id: nameToStateIdMap[previousStateName],
            name: stripStar(previousStateName),
            isResolved: data.resolvedStates.includes(previousStateName),
          } as StateBundleElement],
          target: {
            $type: 'Issue',
            id: ISSUE_ID(issueIndex),
          },
          timestamp,
        } as CustomFieldActivityItem;
      });
  return irrelevantActivityItems
      .concat(relevantActivityItems)
      .sort((left, right) => left.timestamp! - right.timestamp!);
}

function youTrackError(error: string, description: string): YouTrackError {
  return {
    error,
    error_description: description,
  };
}

export const CUSTOM_FIELD_ID_STATE = 'custom-field-id-state';
export const CUSTOM_FIELD_ID_REMAINING_EFFORT = 'custom-field-id-remaining-effort';
export const CUSTOM_FIELD_ID_REMAINING_WAIT = 'custom-field-id-remaining-wait';
export const CUSTOM_FIELD_ID_ASSIGNEE = 'custom-field-id-assignee';
export const CUSTOM_FIELD_ID_TYPE = 'custom-field-id-type';
export const CUSTOM_FIELD_ID_OTHER = 'custom-field-id-other';
export const ISSUE_ID = (index: number) => index.toString();
export const ISSUE_ID_OTHER = 'issue-id-other';
export const ISSUE_READABLE_ID = (index: number) => `XYZ-${index}`;
export const ISSUE_SUMMARY = (index: number) => `Task #${index}`;
export const LINK_TYPE_ID_DEPENDS = 'link-type-id-depends';
export const LINK_TYPE_ID_SUBTASK = 'link-type-id-subtask';
export const SAVED_QUERY_ID_BASE = 'saved-query-id-base';
export const SAVED_QUERY_ID_OVERLAY = 'saved-query-id-overlay';
export const STATE_BUNDLE_ID_MAIN = 'state-bundle-id-main';
export const STATE_BUNDLE_ID_OTHER = 'state-bundle-id-other';
export const STATE_BUNDLE_ELEMENT_ID = (stateName: string): string => `state-bundle-element-id-${stateName}`;

export default class YouTrackDatabase {
  public sideOfDependsOn: LinkDirection = 'INWARD';

  private readonly issues: InternalIssue[];
  private readonly stateBundles: DeepPartial<StateBundle>[];
  private readonly activities: DeepPartial<ActivityItem>[];
  private readonly youTrackConfigTemplate: YouTrackConfig;

  constructor(data: YouTrackData) {
    interface StatesBuilder {
      nameToStateIdMap: StringToStringDict;
      mainBundleStates: DeepPartial<StateBundleElement>[];
      otherBundleStates: DeepPartial<StateBundleElement>[];
    }

    const issues: Required<YouTrackDataIssue>[] = data.issues
      .map((issue: YouTrackDataIssue) => assignDefined(newDefaultYouTrackDataIssue(), issue));
    const strictYouTrackData: StrictYouTrackData = assignDefined(newDefaultYouTrackData(), {...data, issues});
    const {nameToStateIdMap, mainBundleStates, otherBundleStates}: StatesBuilder = strictYouTrackData.issues
        .flatMap((issue) => issue.states)
        .flatMap(([ignoredDay, ...stateNames]) => stateNames)
        .concat(strictYouTrackData.inactiveUnresolvedStates, strictYouTrackData.resolvedStates)
        .reduce((statesBuilder: StatesBuilder, stateName: string) => {
          if (stateName === '') {
            return statesBuilder;
          }

          // noinspection JSMismatchedCollectionQueryUpdate
          let addToBundle: DeepPartial<StateBundleElement>[];
          let elementName;
          if (stateName.charAt(0) === '*') {
            addToBundle = statesBuilder.otherBundleStates;
            elementName = stateName.slice(1);
          } else {
            addToBundle = statesBuilder.mainBundleStates;
            elementName = stateName;
          }
          if (!(stateName in statesBuilder.nameToStateIdMap)) {
            const elementId = STATE_BUNDLE_ELEMENT_ID(stateName);
            statesBuilder.nameToStateIdMap[stateName] = elementId;
            addToBundle.push({
              id: elementId,
              name: elementName,
              isResolved: strictYouTrackData.resolvedStates.includes(stateName),
            });
          }
          return statesBuilder;
        }, {nameToStateIdMap: {}, mainBundleStates: [], otherBundleStates: []});

    this.issues = internalIssuesFromData(strictYouTrackData, nameToStateIdMap);
    this.stateBundles = stateBundlesFrom(mainBundleStates, otherBundleStates);
    this.activities = activitiesFromData(strictYouTrackData, nameToStateIdMap);
    this.youTrackConfigTemplate = youTrackConfigForData(strictYouTrackData, nameToStateIdMap, this.sideOfDependsOn);
  }

  public youTrackConfig(): YouTrackConfig {
    return {
      ...JSON.parse(JSON.stringify(this.youTrackConfigTemplate)),
      doesInwardDependOnOutward: this.sideOfDependsOn === 'INWARD',
    };
  }

  private baseIssues(): DeepPartial<Issue>[] {
    return this.issues.map((issue) => {
      return {
        created: issue.created,
        customFields: [{
          $type: 'StateIssueCustomField',
          projectCustomField: {
            field: {
              id: CUSTOM_FIELD_ID_STATE,
            },
          },
          value: issue.stateBundleId !== STATE_BUNDLE_ID_MAIN ? null : {
            id: issue.stateId,
            name: issue.stateName,
          },
        } as StateIssueCustomField, {
          $type: 'SingleEnumIssueCustomField',
          projectCustomField: {
            field: {
              id: CUSTOM_FIELD_ID_TYPE,
            },
          },
          value: {
            id: issue.typeId,
          },
        } as SingleEnumIssueCustomField, {
          $type: 'PeriodIssueCustomField',
          projectCustomField: {
            field: {
              id: CUSTOM_FIELD_ID_REMAINING_EFFORT,
            },
          },
          value: issue.remainingEffortMin === null ? null : {
            minutes: issue.remainingEffortMin,
          } as PeriodValue,
        } as PeriodIssueCustomField, {
          $type: 'PeriodIssueCustomField',
          projectCustomField: {
            field: {
              id: CUSTOM_FIELD_ID_REMAINING_WAIT,
            },
          },
          value: issue.remainingWaitMin === null ? null : {
            minutes: issue.remainingWaitMin,
          } as PeriodValue,
        } as PeriodIssueCustomField, {
          $type: 'SingleUserIssueCustomField',
          projectCustomField: {
            field: {
              id: CUSTOM_FIELD_ID_ASSIGNEE,
            },
          },
          value: issue.assigneeId === '' ? null : {
            id: issue.assigneeId,
          } as User,
        } as SingleUserIssueCustomField, {
          $type: 'SingleEnumIssueCustomField',
          projectCustomField: {
            field: {
              id: CUSTOM_FIELD_ID_OTHER,
            },
          },
          value: null,
        } as SingleEnumIssueCustomField] as IssueCustomField[],
        id: issue.id,
        idReadable: issue.idReadable,
        links: (issue.subtaskOf === null ? [] : [issue.subtaskOf])
            .map((parentId) => ({
              ...parentId,
              type: LINK_TYPE_ID_SUBTASK,
              direction: 'INWARD',
            }))
            .concat(
                issue.parentFor.map((childId) => ({
                  ...childId,
                  type: LINK_TYPE_ID_SUBTASK,
                  direction: 'OUTWARD',
                }))
            )
            .concat(
                issue.dependsOn.map((dependencyId) => ({
                  ...dependencyId,
                  type: LINK_TYPE_ID_DEPENDS,
                  direction: this.sideOfDependsOn,
                }))
            )
            .concat(
                issue.isRequiredFor.map((dependentId) => ({
                  ...dependentId,
                  type: LINK_TYPE_ID_DEPENDS,
                  direction: this.sideOfDependsOn === 'INWARD' ? 'OUTWARD' : 'INWARD',
                }))
            )
            .map(({id, idReadable, type, direction}) => ({
              direction,
              issues: [{
                id,
                idReadable,
              }],
              linkType: {
                id: type,
              },
            })) as IssueLink[],
        parent: {
          issues: issue.subtaskOf === null ? [] : [{
            ...issue.subtaskOf,
          }],
        } as IssueLink,
        subtasks: {
          issues: issue.parentFor.map((childId) => ({
            ...childId,
          })),
        } as IssueLink,
        resolved: issue.resolved,
        summary: issue.summary,
        updated: issue.updated,
      };
    });
  }

  private overlayIssues(): DeepPartial<Issue>[] {
    const issuesWithEvenIdx = this.baseIssues().filter((ignoredIssue, idx) => idx % 2 === 0).reverse();
    // No need to set more properties, they should all be ignored anyway
    issuesWithEvenIdx.push({
      id: 'IGNORE-1',
    });
    return issuesWithEvenIdx;
  }

  private getSortedIssues(folderId: string): [SortedIssuesResponse, 200] | [YouTrackError, 500] {
    const sortedIssueResponse = (count: number): [SortedIssuesResponse, 200] => ([{
      count,
    }, 200]);
    switch (folderId) {
      case SAVED_QUERY_ID_BASE: return sortedIssueResponse(this.baseIssues().length);
      case SAVED_QUERY_ID_OVERLAY: return sortedIssueResponse(this.overlayIssues().length);
      case undefined: return sortedIssueResponse(Number.MAX_SAFE_INTEGER);
      default: return [youTrackError('server_error', 'SavedQuery was removed.'), 500];
    }
  }

  private getSavedQuery(id: string): [DeepPartial<SavedQuery>, 200] | [YouTrackError, 404] {
    const savedQueryResponse = (name: string): [DeepPartial<SavedQuery>, 200] => [{
      id,
      name,
    }, 200];
    switch (id) {
      case SAVED_QUERY_ID_BASE: return savedQueryResponse('Saved Search: Base');
      case SAVED_QUERY_ID_OVERLAY: return savedQueryResponse('Saved Search: Overlay');
      default: return [youTrackError('Not Found', `Entity with id ${id} not found`), 404];
    }
  }

  private getSavedQueryIssues(id: string, startIndex: number, endIndex: number):
      [DeepPartial<Issue>[], 200] | [YouTrackError, 404] {
    switch (id) {
      case SAVED_QUERY_ID_BASE: return [this.baseIssues().slice(startIndex, endIndex), 200];
      case SAVED_QUERY_ID_OVERLAY: return [this.overlayIssues().slice(startIndex, endIndex), 200];
      default: return [youTrackError('Not Found', `Entity with id ${id} not found`), 404];
    }
  }

  private static getCustomField(id: string): [DeepPartial<CustomField>, 200] | [YouTrackError, 404] {
    switch (id) {
      case CUSTOM_FIELD_ID_STATE:
        return [{
          fieldDefaults: {
            bundle: {
              id: STATE_BUNDLE_ID_MAIN,
            },
          },
        } as DeepPartial<CustomField>, 200];
      case CUSTOM_FIELD_ID_REMAINING_EFFORT: case CUSTOM_FIELD_ID_REMAINING_WAIT: case CUSTOM_FIELD_ID_ASSIGNEE:
      case CUSTOM_FIELD_ID_TYPE:
        throw Error(`REST endpoint for getting custom field with id ${id} not implemented.`);
      default: return [youTrackError('Not Found', `Entity with id ${id} not found`), 404];
    }
  }

  public responseForRequest(url: URL): [any, number] {
    const pathname: string = url.pathname;
    const queryDict: {[name: string]: string} = {};
    url.searchParams.forEach((value, key) => queryDict[key] = value);

    let startIndex: number = queryDict.$skip !== undefined ? parseInt(queryDict.$skip, 10) : 0;
    const endIndex: () => number = () =>
        queryDict.$top !== undefined ? startIndex + parseInt(queryDict.$top, 10) : Number.MAX_SAFE_INTEGER;
    let completeResponse: [any, number];
    switch (pathname) {
      case '/youtrack/api/admin/customFieldSettings/bundles/state':
        completeResponse = [this.stateBundles.slice(startIndex, endIndex()), 200];
        break;
      case '/youtrack/api/admin/timeTrackingSettings/workTimeSettings':
        completeResponse = [{
          minutesADay: 8 * 60,
          daysAWeek: 5,
        } as WorkTimeSettings, 200];
        break;
      case '/youtrack/api/sortedIssues':
        completeResponse = this.getSortedIssues(queryDict.folderId);
        break;
      case '/youtrack/api/activitiesPage':
        if (queryDict.cursor !== undefined) {
          const cursorMatch: RegExpMatchArray | null = queryDict.cursor.match(/start-at-([0-9]+)/);
          if (cursorMatch === null) {
            completeResponse = [youTrackError('bad_request', `For input string: \"${queryDict.cursor}\"`), 400];
            break;
          }
          startIndex = parseInt(cursorMatch[1], 10);
        } else {
          startIndex = 0;
        }
        completeResponse = [{
          afterCursor: `start-at-${endIndex()}`,
          // Setting 'hasAfter = endIndex() < this.activities.length' would be the expected thing to do, but we want the
          // client also to handle empty responses.
          hasAfter: startIndex < this.activities.length,
          activities: this.activities.slice(startIndex, endIndex()),
        } as ActivityCursorPage, 200];
        break;
      default:
        let pathMatch: RegExpMatchArray | null;
        pathMatch = pathname.match(/^\/youtrack\/api\/savedQueries\/([a-z0-9\-]+)$/);
        if (pathMatch !== null) {
          completeResponse = this.getSavedQuery(pathMatch[1]);
          break;
        }

        pathMatch = pathname.match(/^\/youtrack\/api\/savedQueries\/([a-z0-9\-]+)\/issues$/);
        if (pathMatch != null) {
          completeResponse = this.getSavedQueryIssues(pathMatch[1], startIndex, endIndex());
          break;
        }

        pathMatch = pathname.match(/^\/youtrack\/api\/admin\/customFieldSettings\/customFields\/([a-z0-9\-]+)$/);
        if (pathMatch != null) {
          completeResponse = YouTrackDatabase.getCustomField(pathMatch[1]);
          break;
        }

        // The test logic is behind the implementation if we end up here...
        throw new Error(`REST endpoint ${pathname} not implemented.`);
    }
    // Response must obviously survive JSON serialization. Also, we would want to return a deep clone anyway.
    const cloned = JSON.parse(JSON.stringify(completeResponse[0]));
    return [extractProperties(cloned, parseFieldsParameter(queryDict.fields)), completeResponse[1]];
  }
}
