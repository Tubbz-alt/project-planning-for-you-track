export interface FieldsParameters {
  [fieldName: string]: FieldsParameters;
}

export function parseFieldsParameter(expression: string): FieldsParameters {
  function parseField(remainingInput: string, context: FieldsParameters): number {
    const fieldMatch: RegExpMatchArray | null = remainingInput.match(/^[$a-zA-Z]+/);
    expect(fieldMatch).not.toBeNull();
    let consumed = fieldMatch![0].length;
    const newContext = {};
    context[fieldMatch![0]] = newContext;

    const nextToken = remainingInput.charAt(consumed);
    if (nextToken === '(') {
      ++consumed;
      consumed += parseFields(remainingInput.slice(consumed), newContext);
      expect(remainingInput.charAt(consumed)).toBe(')');
      ++consumed;
    }
    return consumed;
  }

  function parseFields(remainingInput: string, context: FieldsParameters): number {
    let consumed = 0;
    while (true) {
      consumed += parseField(remainingInput.slice(consumed), context);
      const startOfNextToken = remainingInput.charAt(consumed);
      if (startOfNextToken === ',') {
        consumed += startOfNextToken.length;
      } else {
        break;
      }
    }
    return consumed;
  }

  expect(typeof expression).toBe('string');
  const rootContext: FieldsParameters = {};
  parseFields(expression, rootContext);
  return rootContext;
}

export function extractProperties(object: any, properties: FieldsParameters): any {
  const isPrimitive = (value: any) => (value === null || ['string', 'number', 'boolean'].includes(typeof value));

  if (isPrimitive(object)) {
    return object;
  } else if (object instanceof Array) {
    const newArray = [];
    for (const element of object) {
      newArray.push(extractProperties(element, properties));
    }
    return newArray;
  }

  const newObject: {[key: string]: any} = {};
  for (const key in properties) {
    if (properties.hasOwnProperty(key) && object.hasOwnProperty(key)) {
      newObject[key] = extractProperties(object[key], properties[key]);
    }
  }

  for (const key in object) {
    if (object.hasOwnProperty(key) && key.charAt(0) === '$' && isPrimitive(object[key])) {
      newObject[key] = object[key];
    }
  }

  return newObject;
}
