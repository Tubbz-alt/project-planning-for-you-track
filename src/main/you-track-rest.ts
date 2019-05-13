/**
 * Types defined by the [YouTrack REST API](https://www.jetbrains.com/help/youtrack/standalone/api-entities.html).
 */

/**
 * YouTrack REST API paths.
 */
export const youTrackPath = Object.freeze({
  ACTIVITIES_PAGE: 'youtrack/api/activitiesPage',
  CUSTOM_FIELD: (customFieldId: string) => `youtrack/api/admin/customFieldSettings/customFields/${customFieldId}`,
  ISSUES: (queryId: string) => `youtrack/api/savedQueries/${queryId}/issues`,
  OAUTH: 'hub/api/rest/oauth2/auth',
  SAVED_QUERY: (queryId: string) => `youtrack/api/savedQueries/${queryId}`,
  SORTED_ISSUES: 'youtrack/api/sortedIssues',
  STATE_BUNDLES: 'youtrack/api/admin/customFieldSettings/bundles/state',
  WORK_TIME_SETTINGS: 'youtrack/api/admin/timeTrackingSettings/workTimeSettings',
});

export interface ActivityCursorPage {
  afterCursor?: string;
  hasAfter: boolean;
  activities: ActivityItem[];
}

export interface ActivityItem {
  $type: string;
  timestamp: number;
  added: any[];
  removed: any[];
  field: FilterField;
}

export interface BaseBundle extends Bundle {
  values: BundleElement[];
}

export interface Bundle {
  id: string;
}

export interface BundleCustomFieldDefaults extends CustomFieldDefaults {
  $type: string;
}

export interface BundleElement {
  id: string;
  name: string;
  ordinal: number;
  color: FieldStyle;
}

export interface CustomField {
  id: string;
  fieldDefaults: CustomFieldDefaults;
  fieldType: FieldType;
  name: string;
}

export interface CustomFieldActivityItem extends ActivityItem {
  $type: 'CustomFieldActivityItem';
  target: Issue;
}

// tslint:disable-next-line:no-empty-interface
export interface CustomFieldDefaults {}

export interface EnumBundleCustomFieldDefaults extends BundleCustomFieldDefaults {
  bundle: EnumBundle;
}

export interface EnumBundle extends BaseBundle {
  values: EnumBundleElement[];
}

// tslint:disable-next-line:no-empty-interface
export interface EnumBundleElement extends LocalizableBundleElement {}

export interface FieldStyle {
  background: string;
  foreground: string;
}

export interface FieldType {
  id: string;
}

export interface FilterField {
  id: string;
  name: string;
}

export interface Issue {
  $type: 'Issue';
  created: number;
  customFields: IssueCustomField[];
  id: string;
  idReadable: string;
  links: IssueLink[];
  parent: IssueLink;
  subtasks: IssueLink;
  resolved: number | null;
  summary: string;
  updated: number;
}

export interface IssueCustomField {
  $type: string;
  projectCustomField: ProjectCustomField;
}

export interface IssueFolder {
  id: string;
  name: string;
}

export interface IssueLink {
  direction: 'INWARD' | 'OUTWARD' | 'BOTH';
  linkType: IssueLinkType;
  issues: Issue[];
}

export interface IssueLinkType {
  directed: boolean;
  id: string;
  name: string;
  sourceToTarget: string;
  targetToSource: string;
}

// tslint:disable-next-line:no-empty-interface
export interface LocalizableBundleElement extends BundleElement {}

export interface PeriodIssueCustomField extends IssueCustomField {
  $type: 'PeriodIssueCustomField';
  value: PeriodValue | null;
}

export function isPeriodIssueCustomField(field: any): field is PeriodIssueCustomField {
  return field.$type === 'PeriodIssueCustomField';
}

export interface PeriodValue {
  minutes: number;
}

export interface ProjectCustomField {
  field: CustomField;
}

export interface SavedQuery extends WatchFolder {
  issues: Issue[];
}

export interface SortedIssuesResponse {
  count: number;
}

export interface SingleUserIssueCustomField extends IssueCustomField {
  $type: 'SingleUserIssueCustomField';
  value: User | null;
}

export function isSingleUserIssueCustomField(field: any): field is SingleUserIssueCustomField {
  return field.$type === 'SingleUserIssueCustomField';
}

export interface SingleEnumIssueCustomField extends IssueCustomField {
  $type: 'SingleEnumIssueCustomField';
  value: EnumBundleElement | null;
}

export function isSingleEnumIssueCustomField(field: any): field is SingleEnumIssueCustomField {
  return field.$type === 'SingleEnumIssueCustomField';
}

export interface StateBundle extends BaseBundle {
  $type: 'StateBundle';
  values: StateBundleElement[];
}

export interface StateBundleElement extends LocalizableBundleElement {
  isResolved: boolean;
}

export interface StateBundleCustomFieldDefaults extends BundleCustomFieldDefaults {
  bundle: StateBundle;
}

export interface StateIssueCustomField extends IssueCustomField {
  $type: 'StateIssueCustomField';
  value: StateBundleElement;
}

export function isStateIssueCustomField(field: any): field is StateIssueCustomField {
  return field.$type === 'StateIssueCustomField';
}

export interface User {
  id: string;
  avatarUrl: string;
  fullName: string;
}

export interface WatchFolder extends IssueFolder {
  owner: User;
}

export interface WorkTimeSettings {
  minutesADay: number;
  daysAWeek: number;
}

/**
 * Error returned by the YouTrack REST API, typically in case of an invalid request.
 */
export interface YouTrackError {
  error: string;
  error_description: string;
}
