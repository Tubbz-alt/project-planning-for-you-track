import { assignDefined } from '../main/util';

test.each([
  [{foo: 'bar'}, {foo: undefined}, {foo: 'bar'}],
  [{}, {foo: undefined}, {foo: undefined}],
] as [{[key: string]: any}, {[key: string]: any}, {[key: string]: any}][])(
    'assignDefined(%j, %j) === %j', (target, source, expected) => {
  expect(assignDefined(target, source)).toEqual(expected);
});
