// User-defined data. Implementation below.

enum State {
  OPEN = 'Open',
  IN_PROGRESS = 'In Progress',

  /**
   * The issue is done and also resolved.
   */
  DONE = 'Done',
}

enum Type {
  BUG = 'Bug',
  TASK = 'Task',
  EPIC = 'Epic',
  STORY = 'Story',
}

enum User {
  NONE = '',
  ZEPPELIN = 'ferdinand.von_zeppelin',
  PRANDTL = 'ludwig.prandtl',
  GLAUERT = 'hermann.glauert',
  EARHART = 'amelia.earhart',
}

enum CustomField {
  STATE= 'State',
  ASSIGNEE = 'Assignee',
  TYPE = 'Type',
  REMAINING_EFFORT = 'Remaining effort',
  REMAINING_WAIT = 'Remaining wait',
}

enum LinkType {
  SUBTASK = 'Subtask',
  DEPENDS = 'Depend',
}

const demoProject: Project = {
  importSettings: {
    youTrackProjectAbbrev: 'AA',
    importIssues: true,
    importLinks: true,
    importEvents: true,
  },
  // Note that the Date() constructor takes the month arguments as 0-based index, so 6 = July.
  baseDate: new Date(2019, 6, 22),
  issues: [
    {
      no: 1, title: 'Conceptual design for airship prototype', type: Type.EPIC, events: [
        {day: -30, state: State.OPEN},
        {day: -25, assign: User.ZEPPELIN, state: State.IN_PROGRESS},
      ],
    }, {
      no: 2, title: 'Propeller thrust model', type: Type.TASK, par: 1, events: [
        {day: -30, state: State.OPEN},
        {day: -25, assign: User.GLAUERT},
        {day: -20, state: State.IN_PROGRESS},
        {day: -5, state: State.DONE},
      ],
    }, {
      no: 3, title: 'Aerodynamics and aerostatics model', type: Type.TASK, par: 1, events: [
        {day: -30, state: State.OPEN},
        {day: -20, assign: User.PRANDTL},
        {day: -2, state: State.DONE},
      ],
    }, {
      no: 4, title: 'Thermal model for cables and motors', type: Type.TASK, par: 1, rem: 5,
    }, {
      no: 5, title: 'Power supply model: battery, solar panels, MPPT', type: Type.TASK, par: 1, rem: 5,
    }, {
      no: 6, title: 'Comprehensive model of flight physics', type: Type.TASK, par: 1, dep: [2, 3], rem: 15, events: [
        {day: -29, state: State.IN_PROGRESS, assign: User.ZEPPELIN},
        {day: -25, state: State.OPEN, assign: User.NONE},
      ],
    }, {
      no: 7, title: 'Optimize (and then decide for) tech specs', type: Type.TASK, par: 1, dep: [4, 5, 6], rem: 10,
      events: [
        {day: -25, state: State.IN_PROGRESS, assign: User.GLAUERT},
      ],
    }, {
      no: 8, title: 'Fire Department needs communication relay', type: Type.STORY, par: 1, rem: 10, events: [
        {day: -22, state: State.IN_PROGRESS},
      ],
    },

    {
      no: 10, title: 'Apply blade-element momentum theory', type: Type.TASK, par: 2, events: [
        {day: -20, state: State.IN_PROGRESS, assign: User.GLAUERT},
        {day: -15, state: State.DONE},
      ],
    }, {
      no: 11, title: 'Implement modern correction factors', type: Type.TASK, par: 2, events: [
        {day: -20, state: State.OPEN, assign: User.GLAUERT},
        {day: -15, state: State.IN_PROGRESS},
        {day: -5, state: State.DONE},
      ],
    },

    {
      no: 20, title: 'Preliminary CAD Model', type: Type.EPIC, events: [
        {day: -15, state: State.IN_PROGRESS, assign: User.ZEPPELIN},
        {day: -5, state: State.DONE},
      ],
    }, {
      no: 21, title: 'Streamlined hull shape (CAD for prototype)', type: Type.TASK, par: 20, events: [
        {day: -15, state: State.OPEN, assign: User.ZEPPELIN},
        {day: -15, state: State.IN_PROGRESS},
        {day: -14, state: State.DONE},
      ],
    }, {
      no: 22, title: 'Fins (CAD for prototype)', type: Type.TASK, par: 20, events: [
        {day: -15, state: State.OPEN, assign: User.ZEPPELIN},
        {day: -14, state: State.IN_PROGRESS},
        {day: -10, state: State.DONE},
      ],
    }, {
      no: 23, title: 'Gondola (CAD for prototype)', type: Type.TASK, par: 20, events: [
        {day: -15, state: State.OPEN, assign: User.ZEPPELIN},
        {day: -10, state: State.IN_PROGRESS},
        {day: -7, state: State.DONE},
      ],
    }, {
      no: 24, title: 'Obtain CAD models for third-party components', type: Type.TASK, par: 20, events: [
        {day: -15, state: State.OPEN, assign: User.ZEPPELIN},
        {day: -7, state: State.IN_PROGRESS},
        {day: -5, state: State.DONE},
      ],
    },

    { no: 30, title: 'Qualify vendors and sample components', type: Type.EPIC, dep: [20] },
    { no: 31, title: 'Build test stand for power cables', type: Type.TASK, par: 20, dep: [4], rem: 5 },
    { no: 32, title: 'Order tailor-made propellers', type: Type.TASK, par: 20, dep: [2], rem: 2, wait: 10 },
    { no: 33, title: 'Choose brushless DC motors', type: Type.TASK, par: 20, rem: 2, wait: 10 },
    { no: 34, title: 'Find vendor for fins', type: Type.TASK, par: 20, rem: 2 },

    { no: 40, title: 'Assemble airship prototype', type: Type.EPIC, rem: 20, dep: [30] },

    {
      no: 50, title: 'Flight tests with airship prototype', type: Type.EPIC, dep: [40], rem: 30, events: [
        {day: -15, state: State.OPEN, assign: User.EARHART},
      ],
    },

    {
      no: 60, title: 'Endless loop in propeller thrust calculator', type: Type.BUG, events: [
        {day: -10, state: State.OPEN},
        {day: -2, state: State.IN_PROGRESS, assign: User.GLAUERT},
        {day: 0, state: State.DONE},
      ],
    },
  ],
};


// Implementation.

import { strict as assert } from 'assert';
import fs from 'fs';
import { JSDOM } from 'jsdom';


interface Project {
  importSettings: ImportSettings;

  /**
   * Start date of the project. Assumed to be a Monday (to respect workdays).
   */
  baseDate: Date;

  issues: Issue[];
}

interface ImportSettings {
  youTrackProjectAbbrev: string;
  importIssues: boolean;
  importLinks: boolean;
  importEvents: boolean;
}

interface Issue {
  no: number;
  title: string;
  type: Type;

  /**
   * Remaining effort in days. By default, this is 0.
   */
  rem?: number;

  /**
   * Remaining wait time in days. By default, this is 0.
   */
  wait?: number;

  /**
   * Parent issue.
   */
  par?: number;

  /**
   * Dependencies; that is, issues that this issue depends on.
   */
  dep?: number[];

  /**
   * Events (activity items). By default, this is a singleton array containing an event with the current timestamp
   * (where current is relative to the order in which issues are processed) and state {@link State.OPEN}.
   */
  events?: Event[];
}

interface Event {
  /**
   * Number of days after {@link Project.baseDate}.
   */
  day: number;

  assign?: User;
  state?: State;
}


// BEGIN Setup jsdom in node.js
declare global {
  namespace NodeJS {
    // noinspection JSUnusedGlobalSymbols
    interface Global {
      document: Document;
      XMLSerializer: typeof XMLSerializer;
    }
  }
}

// The jsdom type definitions are lagging behind unfortunately.
declare module 'jsdom' {
  // noinspection JSUnusedGlobalSymbols
  interface DOMWindow {
    XMLSerializer: typeof XMLSerializer;
  }
}

const { window } = new JSDOM();
global.document = window.document;
global.XMLSerializer = window.XMLSerializer;
// END Setup jsdom in node.js

function createImportXmlDocuments(project: Project):
    {
      importSettingsDoc: XMLDocument;
      issuesDoc: XMLDocument;
      linksDoc: XMLDocument;
      eventsDoc: XMLDocument;
    } {
  const toEpochMs = (timestamp: number): number => datePlusWorkdays(project.baseDate, timestamp).getTime();

  const importSettingsDoc: XMLDocument = document.implementation.createDocument('', '', null);
  const issuesDoc: XMLDocument = document.implementation.createDocument('', '', null);
  const linksDoc: XMLDocument = document.implementation.createDocument('', '', null);
  const eventsDoc: XMLDocument = document.implementation.createDocument('', '', null);

  const importSettingsRoot = createImportSettingsElement(importSettingsDoc, project.importSettings);
  // https://www.jetbrains.com/help/youtrack/standalone/Import-Issues.html
  const issuesRoot = issuesDoc.createElement('issues');
  // https://www.jetbrains.com/help/youtrack/standalone/Import-Links.html
  const linksRoot = linksDoc.createElement('list');
  const eventsRoot = eventsDoc.createElement('events');

  let currentDay: number =
      (project.issues.length === 0 || project.issues[0].events === undefined || project.issues[0].events.length === 0)
          ? 0
          : project.issues[0].events[0].day;
  for (const issue of project.issues) {
    const issueDay: number = (issue.events !== undefined && issue.events.length > 0)
        ? issue.events[0].day
        : currentDay;
    if (issueDay < currentDay) {
      throw new Error('Issue creation days (timestamps) must be non-decreasing.');
    } else {
      currentDay = issueDay;
    }
    const issueEvents: Event[] = (issue.events === undefined || issue.events.length === 0)
        ? [{day: currentDay, state: State.OPEN}]
        : issue.events;

    issuesRoot.appendChild(createIssueElement(issuesDoc, issue, issueEvents, toEpochMs));
    linksRoot.append(...createLinkElements(linksDoc, issue, project.importSettings.youTrackProjectAbbrev));
    eventsRoot.append(...createEventElements(eventsDoc, issue, issueEvents, toEpochMs));
  }

  importSettingsDoc.appendChild(importSettingsRoot);
  issuesDoc.appendChild(issuesRoot);
  linksDoc.appendChild(linksRoot);
  eventsDoc.appendChild(eventsRoot);
  return {importSettingsDoc, issuesDoc, linksDoc, eventsDoc};
}

function createImportSettingsElement(xmlDocument: XMLDocument, importSettings: ImportSettings): Element {
  const importSettingsElement: Element = xmlDocument.createElement('importSettings');
  const addProperty = (key: keyof ImportSettings): void => {
    const propertyElement = xmlDocument.createElement(key);
    propertyElement.textContent = importSettings[key].toString();
    importSettingsElement.appendChild(propertyElement);
  };
  Object.keys(importSettings).forEach((key) => addProperty(key as keyof typeof importSettings));
  return importSettingsElement;
}

function createIssueElement(xmlDocument: XMLDocument, issue: Issue, issueEvents: Event[],
    toEpochMs: (day: number) => number): Element {
  assert(issueEvents.length > 0);

  const issueElement: Element = xmlDocument.createElement('issue');
  const addField = (name: string, value: string | number | undefined): void => {
    let stringValue: string;
    switch (typeof value) {
      case 'string': stringValue = value; break;
      case 'undefined': return;
      default: stringValue = value.toString(); break;
    }

    const fieldElement = xmlDocument.createElement('field');
    fieldElement.setAttribute('name', name);
    const valueElement = xmlDocument.createElement('value');
    valueElement.textContent = stringValue;
    fieldElement.appendChild(valueElement);
    issueElement.appendChild(fieldElement);
  };
  // Required fields
  addField('numberInProject', issue.no);
  addField('summary', issue.title);
  addField('created', toEpochMs(requireDefined(findFirst('day', issueEvents)).day));
  addField('reporterName', User.ZEPPELIN);
  // Optional pre-defined fields
  addField('updated', toEpochMs(issueEvents[issueEvents.length - 1].day));
  addField('resolved', allowUndefined(toEpochMs)(findLastDay('state', issueEvents, (state) => state === State.DONE)));
  // Custom Fields
  addField(CustomField.ASSIGNEE, findLastValue('assign', issueEvents));
  addField(CustomField.STATE, findLastValue('state', issueEvents));
  addField(CustomField.TYPE, issue.type);
  addField(CustomField.REMAINING_EFFORT, allowUndefined(toMinutes)(issue.rem));
  addField(CustomField.REMAINING_WAIT, allowUndefined(toMinutes)(issue.wait));
  return issueElement;
}

function createLinkElements(xmlDocument: XMLDocument, issue: Issue, projectAbbreviation: string): Element[] {
  const linkElements: Element[] = [];
  const addLink = (type: string, source: number, target: number) => {
    const linkElement = xmlDocument.createElement('link');
    linkElement.setAttribute('typeName', type);
    linkElement.setAttribute('source', `${projectAbbreviation}-${source}`);
    linkElement.setAttribute('target', `${projectAbbreviation}-${target}`);
    linkElements.push(linkElement);
  };
  if (issue.par !== undefined) {
    addLink(LinkType.SUBTASK, issue.par, issue.no);
  }
  for (const dependency of orElse(issue.dep, [])) {
    addLink(LinkType.DEPENDS, dependency, issue.no);
  }
  return linkElements;
}

type EventCustomField = Exclude<keyof Event, 'day'>;

const propertyToFieldMap = {
  assign: CustomField.ASSIGNEE,
  state: CustomField.STATE,
};

function createEventElements(xmlDocument: XMLDocument, issue: Issue, issueEvents: Event[],
    toEpochMs: (day: number) => number): Element[] {
  const eventElements: Element[] = [];
  const eventCustomFields: EventCustomField[] = ['assign', 'state'];
  const latest: Pick<Event, EventCustomField> = {};
  let isFirstEvent = true;
  for (const event of issueEvents) {
    // As far as I know, the only way to introduce a type variable T is by defining a function. We need the type
    // variable to represent exactly one of the the possible actual types of 'field'. We cannot use 'typeof field'
    // instead, because that instead gives a union type (over all possible types that 'field' could assume using
    // static analysis).
    const addEventForFieldIfNecessary = <T extends EventCustomField>(field: T) => {
      type Value = (typeof latest)[T];
      // Oddly, TypeScript 3.5.3 would complain about 'type Value = Event[T]'.
      if (event[field] !== undefined) {
        const newValue: NonNullable<Value> = event[field]!;
        const previousValue: Value = latest[field];

        if (!isFirstEvent) {
          const eventElement = xmlDocument.createElement('customFieldEvent');
          eventElement.setAttribute('timestamp', toEpochMs(event.day).toString());
          eventElement.setAttribute('numberInProject', issue.no.toString());
          eventElement.setAttribute('field', propertyToFieldMap[field]);
          eventElement.setAttribute('author', User.ZEPPELIN);

          if (newValue.length > 0) {
            const addedElement = xmlDocument.createElement('added');
            addedElement.textContent = newValue;
            eventElement.appendChild(addedElement);
          }
          if (previousValue !== undefined && previousValue.length > 0) {
            const removedElement = xmlDocument.createElement('removed');
            // Oddly, TypeScript would complain without the exclamation mark!
            removedElement.textContent = previousValue!;
            eventElement.appendChild(removedElement);
          }
          eventElements.push(eventElement);
        }

        latest[field] = newValue;
      }
    };
    eventCustomFields.forEach(addEventForFieldIfNecessary);
    isFirstEvent = false;
  }
  return eventElements;
}

function orElse<T>(value: T | undefined, defaultValue: T): T {
  return value === undefined
      ? defaultValue
      : value;
}

function opt<T, P extends keyof T>(obj: T | undefined, property: P): T[P] | undefined {
  return obj === undefined
      ? undefined
      : obj[property];
}

function findFirst<P extends keyof Event>(property: P, events: Event[]): Event | undefined {
  for (const event of events) {
    const value: Event[P] = event[property];
    if (value !== undefined) {
      return event;
    }
  }
  return undefined;
}

function findLast<P extends keyof Event>(property: P, events: Event[],
    predicate: (value: Event[P]) => boolean = () => true): Event | undefined {
  for (let i = events.length - 1; i >= 0; --i) {
    const event = events[i];
    const value: Event[P] = event[property];
    if (value !== undefined && predicate(value)) {
      return event;
    }
  }
  return undefined;
}

function findLastValue<P extends keyof Event>(property: P, events: Event[],
    predicate: (value: Event[P]) => boolean = () => true): Event[P] | undefined {
  return opt(findLast(property, events, predicate), property);
}

function findLastDay<P extends keyof Event>(property: P, events: Event[],
    predicate: (value: Event[P]) => boolean = () => true): number | undefined {
  return opt(findLast(property, events, predicate), 'day');
}

function allowUndefined<T extends (argument: any) => any>(fn: T):
    (argument: Parameters<T>[0] | undefined) => (ReturnType<T> | undefined) {
  return (argument) => argument === undefined
      ? undefined
      : fn(argument);
}

function requireDefined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Value required.');
  } else {
    return value;
  }
}

function datePlusWorkdays(date: Date, workdays: number): Date {
  const newDate = new Date(date.getTime());
  const numWeeks = Math.floor(workdays / 5);
  const remainingDays = workdays % 5;
  newDate.setDate(newDate.getDate() + (numWeeks * 7) + remainingDays);
  return newDate;
}

function toMinutes(days: number): number {
  return days * 8 * 60;
}

function run(): void {
  const xmlSerializer = new XMLSerializer();
  const {importSettingsDoc, issuesDoc, linksDoc, eventsDoc} = createImportXmlDocuments(demoProject);
  fs.writeFileSync('ImportSettings.xml', xmlSerializer.serializeToString(importSettingsDoc));
  fs.writeFileSync('Issues.xml', xmlSerializer.serializeToString(issuesDoc));
  fs.writeFileSync('List.xml', xmlSerializer.serializeToString(linksDoc));
  fs.writeFileSync('Events.xml', xmlSerializer.serializeToString(eventsDoc));
}

run();
