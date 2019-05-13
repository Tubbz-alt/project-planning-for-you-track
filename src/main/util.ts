/**
 * This module is not part of the public API!
 */

/* API Barrier */

import { strict as assert } from 'assert';

/**
 * Type that consists of the union of all properties that are marked as optional through a question mark.
 *
 * Note that properties that have undefined in their domain, but no question mark next to the property name are *not*
 * included. Also note that, in strict compilation mode, TypeScript will add undefined to the domain of the property if
 * there is a question mark next to the property name.
 *
 * @typeparam T generic type parameter
 */
export type OptionalPropertyNames<T extends {}> = {[K in keyof T]-?: {} extends {[_ in K]: T[K]} ? K : never}[keyof T];
export type Defined<T> = T extends undefined ? never : T;
export type OnlyOptionals<T extends {}> = {[K in OptionalPropertyNames<T>]: Defined<T[K]>};

/**
 * Copy the values of all string-keyed enumerable own properties from the source object to the target object.
 *
 * Note the differences to
 * [`Object.assign()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign):
 * - Only String properties are copied.
 * - A property of the source value that has the value undefined is copied only if the property key is not yet in the
 *   target. (The check is performed using the `in` operator.)
 *
 * @param target the target object
 * @param source the source object
 * @return the target object
 */
export function assignDefined<T extends {[key: string]: any}, U extends {[key: string]: any}>(
    target: T, source: U): T & U {
  const typedTarget: T & U = target as T & U;
  // Object.entries() returns “a given object's own enumerable string-keyed property [key, value] pairs,”
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/entries
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target) || value !== undefined) {
      // Casting of key necessary for type soundness:
      // https://github.com/microsoft/TypeScript/issues/31661#issuecomment-497474815
      typedTarget[key as keyof U] = source[key];
    }
  }
  return target as T & U;
}

/**
 * Returns a deep clone of the given object.
 *
 * This function covers only what is needed in this project! It is not an equivalent to a library function.
 */
export function deepClone<T>(original: T): T {
  assert(['undefined', 'object', 'boolean', 'number', 'string'].includes(typeof original),
      'Value with unsupported type in deepClone()');
  if (Array.isArray(original)) {
    return original.map(deepClone) as T & any[];
  } else if (typeof original === 'object' && original !== null) {
    return Object.entries(original).reduce((obj, [key, value]) => {
      // Casting of key necessary for type soundness:
      // https://github.com/microsoft/TypeScript/issues/31661#issuecomment-497474815
      obj[key as keyof T] = deepClone(value);
      return obj;
    }, {} as T & {[key: string]: any});
  } else {
    return original;
  }
}

/**
 * Returns the first argument that is defined, or undefined if none of the arguments is defined.
 */
export function coalesce<T>(left: T | undefined, right: T): T {
  return left === undefined ? right : left;
}
