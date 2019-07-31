import { extractProperties, FieldsParameters, parseFieldsParameter } from './fields-parameters';

test.each<[string, FieldsParameters]>([
  ['id', {id: {}}],
  ['id,value(isResolved)', {id: {}, value: {isResolved: {}}}],
  ['foo(bar(baz,qux)))', {foo: {bar: {baz: {}, qux: {}}}}],
])('parse of fields parameter "%s" succeeds', (expression, expected) => {
  expect(parseFieldsParameter(expression)).toEqual(expected);
});

test.each<string>([
  'id(',
  ',',
  ')',
  'a()',
  'a(foo,)',
  'a(,foo)',
])('parse of fields parameter "%s" fails', (expression) => {
  expect(() => parseFieldsParameter(expression)).toThrow();
});

test('extract properties', () => {
  expect(extractProperties({
    foo: [1, 2],
    bar: [{
      baz: [{
        $type: 'baz',
        qux: 3,
      }, {
        quz: false,
      }],
    }],
    nullField: null,
    excludedField: null,
  }, parseFieldsParameter('foo,bar(baz(quz)),nullField'))).toEqual({
    foo: [1, 2],
    bar: [{
      baz: [{
        $type: 'baz',
      }, {
        quz: false,
      }],
    }],
    nullField: null,
  });
});
