import { assignDefined, unreachableCase } from '../main/util';

test.each<[{[key: string]: any}, {[key: string]: any}, {[key: string]: any}]>([
  [{foo: 'bar'}, {foo: undefined}, {foo: 'bar'}],
  [{}, {foo: undefined}, {foo: undefined}],
])('assignDefined(%j, %j) === %j', (target, source, expected) => {
  expect(assignDefined(target, source)).toEqual(expected);
});

test('unreachableCase()', () => {
  expect(() => unreachableCase(0 as never)).toThrow('Unexpected case that should be unreachable: 0');
});
