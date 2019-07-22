import { strict as assert } from 'assert';
import {
  appendSchedule,
  Failure,
  getMinutesPerWorkWeek,
  goToOauthPage,
  handlePotentialOauthRedirect,
  httpGetAll,
  isFailure,
  IssueActivity,
  ProgressCallback,
  ProjectPlan,
  retrieveProjectPlan,
  Schedule,
  scheduleUnresolved,
  SchedulingOptions,
  YouTrackConfig,
  YouTrackIssue,
} from '../main';
import {
  CustomField,
  EnumBundleCustomFieldDefaults,
  IssueLinkType,
  SavedQuery,
  StateBundleCustomFieldDefaults,
  User,
} from '../main/you-track-rest';


// Constants

const SOURCE_PARAM_NAME: string = 'src';

type AlertKind = 'success' | 'warning';
const ALERT_KINDS: readonly AlertKind[] = Object.freeze(['success', 'warning']);


// HTML elements
// Implied assumption here is this script is loaded after all of the following elements (the <script> element is at the
// very end).

const feedback = document.getElementById('feedback') as HTMLDivElement;
const feedbackTitle: HTMLElement = feedback.querySelector('strong')!;
const feedbackMsg: HTMLElement = feedback.querySelector('span')!;
const inpBaseUrl = document.getElementById('baseUrl')! as HTMLInputElement;
const inpHubUrl = document.getElementById('hubUrl')! as HTMLInputElement;
const inpServiceId = document.getElementById('serviceId')! as HTMLInputElement;
const anchHubIntegrationLinks =
    document.getElementsByClassName('hubIntegrationLink') as HTMLCollectionOf<HTMLAnchorElement>;
const spanCurrentUri = document.getElementById('currentUri')! as HTMLSpanElement;
const spanCurrentOrigin = document.getElementById('currentOrigin')! as HTMLSpanElement;
const anchHubConfiguration = document.getElementById('hubConfiguration')! as HTMLAnchorElement;
const anchGlobalSettingsLink = document.getElementById('globalSettingsLink')! as HTMLAnchorElement;
const btnConnect = document.getElementById('btnConnect')! as HTMLButtonElement;
const lstCustomFields = document.getElementById('customFields')! as HTMLUListElement;
const lstSavedQueries = document.getElementById('savedQueries')! as HTMLUListElement;
const lstIssueLinkTypes = document.getElementById('issueLinkTypes')! as HTMLUListElement;
const lstUsers = document.getElementById('users')! as HTMLUListElement;
const spanMinutesPerWorkWeek = document.getElementById('minutesPerWorkWeek')! as HTMLSpanElement;
const textYouTrackConfig = document.getElementById('youTrackConfig')! as HTMLTextAreaElement;
const textSchedulingOptions = document.getElementById('schedulingOptions')! as HTMLTextAreaElement;
const textIsSplittableFn = document.getElementById('isSplittableFn')! as HTMLTextAreaElement;
const btnPast = document.getElementById('btnPast')! as HTMLButtonElement;
const btnFuture = document.getElementById('btnFuture')! as HTMLButtonElement;
const divProgressBar = document.getElementById('progressBar')! as HTMLDivElement;
const preOutput = document.getElementById('output')! as HTMLPreElement;


// Global state (sigh)

let hashFromShareLink: string = '';
let lastProjectPlan: ProjectPlan | undefined;
let previousNormalizedBaseUrl: string = toNormalizedUrl(inpBaseUrl.value);


interface AppState {
  baseUrl: string;
  hubUrl: string;
  serviceId: string;
  youTrackInstance: string;
  schedulingOptions: string;
  isSplittableFn: string;
}

function toNormalizedUrl(urlString: string): string {
  try {
    const url = new URL(urlString);
    if (url.host.length === 0) {
      // Oddly, Safari 12's implementation of the URL constructor does not throw on 'http:' or 'https:' whereas both
      // Chrome and Firefox do.
      return '';
    } else if (url.pathname.length === 0 || url.pathname.charAt(url.pathname.length - 1) !== '/') {
      url.pathname = url.pathname.concat('/');
    }
    return url.toString();
  } catch (exception) {
    if (!(exception instanceof TypeError)) {
      throw exception;
    }
    return '';
  }
}

function verifiedYouTrackConfig(): YouTrackConfig | undefined {
  let youTrackConfig: YouTrackConfig;
  try {
    youTrackConfig = JSON.parse(textYouTrackConfig.value);
  } catch (syntaxError) {
    showAlert('Parsing YouTrackConfig failed.',
        `The text field does not contain valid JSON. Problem: ${syntaxError.message}`, 'warning');
    return undefined;
  }

  try {
    youTrackConfig.isSplittableFn =
        new Function('issue', textIsSplittableFn.value) as (issue: YouTrackIssue) => boolean;
    return youTrackConfig;
  } catch (syntaxError) {
    showAlert('Parsing isSplittableFn failed.',
        `The text field does not contain a valid JavaScript function body. Problem: ${syntaxError.message}`, 'warning');
    return undefined;
  }
}

function verifiedSchedulingOptions(): SchedulingOptions | undefined {
  try {
    return JSON.parse(textSchedulingOptions.value);
  } catch (syntaxError) {
    showAlert('Parsing SchedulingOptions failed.',
        `The text field does not contain valid JSON. Problem: ${syntaxError.message}`, 'warning');
    return undefined;
  }
}

function hubUrlFromYouTrackBaseUrl(baseUrl: string): {hubUrl: string, isInCloudUrl: boolean} {
  assert(baseUrl.length === 0 || baseUrl.endsWith('/'));

  const inCloudMatch: RegExpMatchArray | null = baseUrl.match(/^(https:\/\/[^./]*\.myjetbrains\.com\/)youtrack\/$/);
  let hubUrl: string;
  let isInCloudUrl: boolean = false;
  if (inCloudMatch !== null) {
    // https://www.jetbrains.com/help/youtrack/incloud/OAuth-Authorization.html#HubOauthEndpoints
    hubUrl = `${inCloudMatch[1]}hub`;
    isInCloudUrl = true;
  } else if (baseUrl.length > 0) {
    // https://www.jetbrains.com/help/youtrack/standalone/OAuth-Authorization.html#HubOauthEndpoints
    hubUrl = `${baseUrl}hub`;
  } else {
    hubUrl = '';
  }
  return {hubUrl, isInCloudUrl};
}

function onBaseUrlChanged() {
  const normalizedBaseUrl = toNormalizedUrl(inpBaseUrl.value);
  const {hubUrl, isInCloudUrl} = hubUrlFromYouTrackBaseUrl(normalizedBaseUrl);
  inpHubUrl.disabled = isInCloudUrl;

  if (inpHubUrl.value === '' || isInCloudUrl ||
      inpHubUrl.value === hubUrlFromYouTrackBaseUrl(previousNormalizedBaseUrl).hubUrl) {
    // The hub URL is currently the default one for the base URL. Keep in sync.
    // If the current if-condition is not true, the user has modified the hub URL, so it shouldn't be updates.
    previousNormalizedBaseUrl = normalizedBaseUrl;
    inpHubUrl.value = hubUrl;
  }
}

function foreach<T extends Element>(collection: HTMLCollectionOf<T>, fn: (element: T) => void) {
  const length = collection.length;
  for (let i = 0; i < length; ++i) {
    fn(collection.item(i)!);
  }
}

function onYouTrackConnectionParametersChanged() {
  const normalizedBaseUrl: string = toNormalizedUrl(inpBaseUrl.value);
  if (normalizedBaseUrl.length > 0) {
    foreach(anchHubIntegrationLinks,
        (anchor) => anchor.setAttribute('href', new URL('admin/ring', normalizedBaseUrl).toString()));
    anchGlobalSettingsLink.setAttribute('href', new URL('admin/settings', normalizedBaseUrl).toString());
  } else {
    foreach(anchHubIntegrationLinks, (anchor) => anchor.removeAttribute('href'));
    anchGlobalSettingsLink.removeAttribute('href');
  }
  if (normalizedBaseUrl.length > 0 && inpServiceId.value.length > 0) {
    anchHubConfiguration.setAttribute('href',
        new URL(`admin/hub/services/${inpServiceId.value}?tab=settings`, normalizedBaseUrl).toString());
  } else {
    anchHubConfiguration.removeAttribute('href');
  }
  const normalizedHubUrl: string = toNormalizedUrl(inpHubUrl.value);
  btnConnect.disabled = normalizedBaseUrl.length === 0 || normalizedHubUrl.length === 0 ||
      inpServiceId.value.length === 0;
}

function getAppState(): AppState {
  return {
    baseUrl: inpBaseUrl.value,
    hubUrl: inpHubUrl.value,
    serviceId: inpServiceId.value,
    youTrackInstance: textYouTrackConfig.value,
    schedulingOptions: textSchedulingOptions.value,
    isSplittableFn: textIsSplittableFn.value,
  };
}

function connect() {
  // The button is only enabled if toNormalizedUrl(inpHubUrl.value).length > 0 returns a string.
  goToOauthPage<AppState>(toNormalizedUrl(inpBaseUrl.value), toNormalizedUrl(inpHubUrl.value), inpServiceId.value,
      getAppState());
}

async function loadFromYouTrack<T>(baseUrl: string, relativePath: string, fields: string): Promise<T[]> {
  return await httpGetAll<T>(baseUrl, relativePath, { fields }, 100);
}

function onReceivedYouTrackMetadata(baseUrl: string, customFields: CustomField[], savedQueries: SavedQuery[],
    issueLinkTypes: IssueLinkType[], users: User[], minutesPerWorkWeek: number): void {
  let customFieldsHtml: string = '';
  for (const customField of customFields) {
    customFieldsHtml += `<li>${customField.id}: ${customField.name}`;
    if (customField.fieldType.id === 'state[1]') {
      const fieldDefaults = customField.fieldDefaults as StateBundleCustomFieldDefaults;
      if (fieldDefaults && fieldDefaults.bundle && fieldDefaults.bundle.values) {
        const stateBundleElements = (customField.fieldDefaults as StateBundleCustomFieldDefaults).bundle.values
            .sort((left, right) => left.ordinal - right.ordinal);
        customFieldsHtml += '<ul>';
        for (const stateBundleElement of stateBundleElements) {
          customFieldsHtml += `<li>${stateBundleElement.id}: ${stateBundleElement.name}`;
          if (stateBundleElement.isResolved) {
            customFieldsHtml += ' (resolved)';
          }
          customFieldsHtml += '</li>';
        }
        customFieldsHtml += '</ul>';
      }
    } else if (customField.fieldType.id === 'enum[1]') {
      const fieldDefaults = customField.fieldDefaults as EnumBundleCustomFieldDefaults;
      if (fieldDefaults && fieldDefaults.bundle && fieldDefaults.bundle.values) {
        const enumBundleElements = (customField.fieldDefaults as EnumBundleCustomFieldDefaults).bundle.values
            .sort((left, right) => left.ordinal - right.ordinal);
        customFieldsHtml += '<ul>';
        for (const enumBundleElement of enumBundleElements) {
          customFieldsHtml += `<li>${enumBundleElement.id}: ${enumBundleElement.name}`;
        }
        customFieldsHtml += '</ul>';
      }
    }
    customFieldsHtml += '</li>';
  }
  lstCustomFields.innerHTML = customFieldsHtml;

  lstSavedQueries.innerHTML = savedQueries
      .map((savedQuery) => `<li>${savedQuery.id}: ${savedQuery.name} (${savedQuery.owner.fullName})</li>`)
      .join('');

  const issueLinkDetails = (issueLinkType: IssueLinkType) =>
      issueLinkType.directed ? ` (${issueLinkType.sourceToTarget} → ${issueLinkType.targetToSource})` : '';
  lstIssueLinkTypes.innerHTML = issueLinkTypes
      .map((issueLinkType) =>
          `<li>${issueLinkType.id}: ${issueLinkType.name}${issueLinkDetails(issueLinkType)}</li>`)
      .join('');
  lstUsers.innerHTML = users.map((user) =>
      '<li>' +
        `<img src="${new URL(user.avatarUrl, baseUrl).toString()}" ` +
          `width="24" height="24" alt="${user.fullName}"/> ${user.id}: ${user.fullName}` +
      '</li>')
      .join('');
  spanMinutesPerWorkWeek.textContent = minutesPerWorkWeek.toString();
}

function currentUri(): URL {
  const uri = new URL(window.location.href);
  uri.hash = '';
  uri.username = '';
  uri.password = '';
  uri.search = '';
  return uri;
}

function currentOrigin(): URL {
  const uri = currentUri();
  uri.pathname = '';
  return uri;
}

function showAlert(title: string, message: string, alertKind: 'success' | 'warning'): void {
  feedbackTitle.innerText = title;
  feedbackMsg.innerText = message;
  feedback.classList.remove(...ALERT_KINDS.map((otherAlertKind) => `alert-${otherAlertKind}`));
  feedback.classList.add(`alert-${alertKind}`);
  feedback.classList.toggle('show', true);
}

function hideAlert() {
  feedback.classList.toggle('show', false);
}

function shareLink(): void {
  const json: string = JSON.stringify(getAppState());
  window.location.replace(`#${SOURCE_PARAM_NAME}=${encodeURIComponent(json)}`);
  hashFromShareLink = window.location.hash;
  let decodedHash: string | undefined;
  try {
    decodedHash = decodeURIComponent(hashFromShareLink);
  } catch (ignoredUriError) { /* ignored */ }
  let title: string;
  let message: string;
  let alertKind: AlertKind;
  if (decodedHash === undefined || decodedHash.slice(2 + SOURCE_PARAM_NAME.length) !== json) {
    title = 'Sharing failed.';
    message = 'Text buffer too large to share.';
    alertKind = 'warning';
  } else {
    title = 'Sharable URL created.';
    message = 'Shareable link now in address bar.';
    alertKind = 'success';
  }
  showAlert(title, message, alertKind);
}

function loadAppState(appState: AppState): void {
  inpBaseUrl.value = appState.baseUrl;
  inpHubUrl.value = appState.hubUrl;
  inpServiceId.value = appState.serviceId;
  previousNormalizedBaseUrl = toNormalizedUrl(appState.baseUrl);
  onBaseUrlChanged();
  onYouTrackConnectionParametersChanged();

  textYouTrackConfig.value = appState.youTrackInstance;
  textSchedulingOptions.value = appState.schedulingOptions;
  textIsSplittableFn.value = appState.isSplittableFn;
}

function loadFromHash(): void {
  // Ignore change of hash (once) if the hash is the one previously set in shareLink().
  if (window.location.hash === hashFromShareLink) {
    hashFromShareLink = '';
    return;
  }

  const urlSearchParams = new URLSearchParams(window.location.hash.slice(1));
  const queryParams = new Map<string, string>(urlSearchParams.entries());
  const encodedJson: string | undefined = queryParams.get(SOURCE_PARAM_NAME);
  if (encodedJson !== undefined) {
    try {
      loadAppState(JSON.parse(decodeURIComponent(encodedJson)));
    } catch (ignoredUriError) {
      showAlert('Invalid URL.', 'Cannot parse the given URL.', 'warning');
      return;
    }
  }
}

function throwIfFailure<T>(valueOrFailure: T | Failure): T {
  if (isFailure(valueOrFailure)) {
    throw valueOrFailure;
  } else {
    return valueOrFailure;
  }
}

function humanReadableTimestamps(projectPlan: ProjectPlan): void {
  interface IsoTimestampedIssue {
    $resolved: string;
  }
  interface IsoTimestampedIssueActivity {
    $start: string;
    $end: string;
  }

  for (const issue of projectPlan.issues) {
    if (issue.resolved !== Number.MAX_SAFE_INTEGER) {
      (issue as YouTrackIssue & IsoTimestampedIssue).$resolved = new Date(issue.resolved).toISOString();
    }
    for (const issueActivity of issue.issueActivities) {
      const timestampedIssueActivity = issueActivity as IssueActivity & IsoTimestampedIssueActivity;
      timestampedIssueActivity.$start = new Date(issueActivity.start).toISOString();
      timestampedIssueActivity.$end = new Date(issueActivity.end).toISOString();
    }
  }
}

async function computePrediction(schedulingOptions: SchedulingOptions): Promise<void> {
  if (lastProjectPlan === undefined) {
    return;
  }

  try {
    const schedule: Schedule = await scheduleUnresolved(lastProjectPlan.issues, schedulingOptions);
    const finalProjectPlan: ProjectPlan = throwIfFailure(appendSchedule(lastProjectPlan, schedule, Date.now()));
    humanReadableTimestamps(finalProjectPlan);
    preOutput.textContent = JSON.stringify(finalProjectPlan, null, 2);
    hideAlert();
  } catch (exception) {
    if (isFailure(exception)) {
      showAlert('Project planning failed.', exception, 'warning');
    } else {
      showAlert('Project planning failed.',
          `The scheduling options may not be valid. Problem (${exception.name}): ${exception.message}`, 'warning');
    }
  }
}

async function computePastProjectPlanAndPrediction(baseUrl: string, youTrackConfig: YouTrackConfig,
    schedulingOptions: SchedulingOptions): Promise<void> {
  try {
    const progressCallback: ProgressCallback = (percentageDone) => {
      const rounded: number = Math.floor(percentageDone);
      divProgressBar.setAttribute('aria-valuenow', rounded.toString());
      divProgressBar.style.width = `${rounded}%`;
    };
    lastProjectPlan = await retrieveProjectPlan(baseUrl, youTrackConfig, {progressCallback});
    btnFuture.disabled = false;
  } catch (exception) {
    if (isFailure(exception)) {
      showAlert('Reconstructing project plan failed.', exception, 'warning');
    } else {
      showAlert('Reconstructing project plan failed.',
          `The YouTrack configuration may not be valid. Problem (${exception.name}): ${exception.message}`, 'warning');
    }
    return;
  }

  await computePrediction(schedulingOptions);
}

function scheduleFromActivityLog(): void {
  const baseUrl: string = toNormalizedUrl(inpBaseUrl.value);
  const youTrackConfig: YouTrackConfig | undefined = verifiedYouTrackConfig();
  const schedulingOptions: SchedulingOptions | undefined = verifiedSchedulingOptions();
  if (baseUrl.length === 0 || youTrackConfig === undefined || schedulingOptions === undefined) {
    return;
  }

  (divProgressBar.parentNode as HTMLElement).classList.remove('d-none');
  btnPast.disabled = true;
  btnFuture.disabled = true;
  computePastProjectPlanAndPrediction(baseUrl, youTrackConfig, schedulingOptions).finally(() => {
    (divProgressBar.parentNode as HTMLElement).classList.add('d-none');
    divProgressBar.setAttribute('aria-valuenow', '0');
    divProgressBar.style.width = '0';
    btnPast.disabled = false;
    btnFuture.disabled = lastProjectPlan === undefined;
  });
}

function predict(): void {
  const schedulingOptions: SchedulingOptions | undefined = verifiedSchedulingOptions();
  if (schedulingOptions === undefined) {
    return;
  }

  btnPast.disabled = true;
  btnFuture.disabled = true;
  computePrediction(schedulingOptions).finally(() => {
    btnPast.disabled = false;
    btnFuture.disabled = lastProjectPlan === undefined;
  });
}

function freshAppState() {
  const youTrackInstance: YouTrackConfig = {
    stateFieldId: '1-1',
    inactiveStateIds: ['2-1'],
    remainingEffortFieldId: '1-2',
    remainingWaitFieldId: '1-3',
    assigneeFieldId: '1-4',
    otherCustomFieldIds: ['1-5'],
    dependsLinkTypeId: '3-1',
    doesInwardDependOnOutward: true,
    savedQueryId: '4-1',
    overlaySavedQueryId: '4-2',
    minStateChangeDurationMs: 3600000,
    defaultRemainingEffortMs: 0,
    defaultWaitTimeMs: 0,
  };
  const schedulingOptions: SchedulingOptions = {
    contributors: [{
      id: '0-0',
      minutesPerWeek: 2400,
      numMembers: 1,
    }],
    resolutionMs: 3600000,
    minActivityDuration: 1,
  };
  const appState: AppState = {
    baseUrl: '',
    hubUrl: '',
    serviceId: '',
    youTrackInstance: JSON.stringify(youTrackInstance, undefined, 2),
    schedulingOptions: JSON.stringify(schedulingOptions, undefined, 2),
    isSplittableFn: "return issue.customFields['1-5'] === '5-1';",
  };
  loadAppState(appState);
}

function resumeFromAppState(appState: AppState) {
  loadAppState(appState);
  // Not bullet-proof, but enough for this demo. We should only get here if the base URL is valid.
  const actualBaseUrl: string = toNormalizedUrl(inpBaseUrl.value);
  Promise
      .all([
        loadFromYouTrack<CustomField>(
            actualBaseUrl,
            'api/admin/customFieldSettings/customFields',
            'fieldDefaults(bundle(id,values(id,name,isResolved,ordinal))),fieldType(id),id,name'
        ),
        loadFromYouTrack<SavedQuery>(
            actualBaseUrl,
            'api/savedQueries',
            'id,name,owner(fullName)'
        ),
        loadFromYouTrack<IssueLinkType>(
            actualBaseUrl,
            'api/issueLinkTypes',
            'directed,id,name,sourceToTarget,targetToSource'
        ),
        loadFromYouTrack<User>(
            actualBaseUrl,
            'api/admin/users',
            'avatarUrl,id,fullName'
        ),
        getMinutesPerWorkWeek(actualBaseUrl),
    ])
    .then((array) => onReceivedYouTrackMetadata(actualBaseUrl, ...array))
    .catch((error) => {
      if (isFailure(error)) {
        showAlert('Loading YouTrack settings failed.', error, 'warning');
      } else {
        showAlert('Loading YouTrack settings failed.', `Problem (${error.name}): ${error.message}`, 'warning');
      }
    });
}


// Set up events

inpBaseUrl.addEventListener('input', onBaseUrlChanged);
inpBaseUrl.addEventListener('input', onYouTrackConnectionParametersChanged);
inpHubUrl.addEventListener('input', onYouTrackConnectionParametersChanged);
inpServiceId.addEventListener('input', onYouTrackConnectionParametersChanged);
btnConnect.onclick = connect;
btnPast.onclick = scheduleFromActivityLog;
btnFuture.onclick = predict;
document.getElementById('btnShare')!.onclick = shareLink;
document.querySelectorAll('button.close[data-dismiss="alert"]').forEach((element: Element) => {
  const alert: Element | null = element.closest('.alert[role="alert"]');
  const button = element as HTMLButtonElement;
  if (alert !== null) {
    button.onclick = () => {
      alert.classList.toggle('show', false);
    };
  }
});
window.onhashchange = loadFromHash;


// Initialization
spanCurrentUri.textContent = currentUri().toString();
spanCurrentOrigin.textContent = currentOrigin().toString();
// Unfortunate workaround for Safari.
// https://github.com/fschopp/project-planning-for-you-track/issues/1
const DELAY_BEFORE_ACCESSING_SESSION_STORAGE_MS = 50;
window.setTimeout(() => {
  const previousState: AppState | undefined = handlePotentialOauthRedirect<AppState>();
  if (previousState === undefined) {
    freshAppState();
  } else {
    resumeFromAppState(previousState);
  }
  loadFromHash();
}, DELAY_BEFORE_ACCESSING_SESSION_STORAGE_MS);
