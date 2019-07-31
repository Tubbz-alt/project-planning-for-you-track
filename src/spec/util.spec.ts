import { assignDefined } from '../main/util';

test.each<[{[key: string]: any}, {[key: string]: any}, {[key: string]: any}]>([
  [{foo: 'bar'}, {foo: undefined}, {foo: 'bar'}],
  [{}, {foo: undefined}, {foo: undefined}],
])('assignDefined(%j, %j) === %j', (target, source, expected) => {
  expect(assignDefined(target, source)).toEqual(expected);
});
