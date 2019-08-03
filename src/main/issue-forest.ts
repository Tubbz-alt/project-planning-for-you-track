import { IssueNode, SchedulableIssue } from './api-types';

/**
 * Creates an issue tree (or forest) representing the given issues, and returns an iterable over all root nodes.
 *
 * @typeparam T the issue type
 * @param issues Array of issues. The array is expected to be “closed” in the sense that a parent or dependency
 *     referenced by any of the issues is guaranteed to be contained in `issues`, too.
 * @return An iterable over all root nodes. The iterable will return the root nodes in the order they appeared in the
 *     array. Likewise, the children of each node (at any level) will be stored in input order.
 */
export function makeForest<T extends SchedulableIssue>(issues: T[]): Iterable<IssueNode<T>> {
  const idToNode: Map<string, IssueNode<T>> = issues
      .reduce((map, issue, index) => map.set(issue.id, {
        index,
        issue,
        children: [],
        dependencies: [],
        dependents: [],
      }), new Map<string, IssueNode<T>>());
  // Creating array, so we later close over a simple data structure instead of a map.
  const nodes: IssueNode<T>[] = Array.from(idToNode.values());
  for (const node of nodes) {
    const issue: T = node.issue;
    const parentKey: string | undefined = issue.parent;
    if (parentKey !== undefined && parentKey.length > 0) {
      node.parent = idToNode.get(parentKey)!;
      node.parent.children.push(node);
    }

    if (issue.dependencies !== undefined) {
      for (const dependency of issue.dependencies) {
        const dependencyNode: IssueNode<T> = idToNode.get(dependency)!;
        dependencyNode.dependents.push(node);
        node.dependencies.push(dependencyNode);
      }
    }
  }
  return {
    * [Symbol.iterator]() {
      for (const node of nodes[Symbol.iterator]()) {
        if (node.parent === undefined) {
          yield node;
        }
      }
    },
  };
}

/**
 * Traverses each of the given issue trees and invokes the given visitor functions.
 *
 * @typeparam T the issue type
 * @param rootNodes The root nodes of the trees making up the forest.
 * @param enterNode Visitor function that will be called on entering a node (that is, before any of its children have
 *     been visited).
 * @param enterNode.node The node that is currently being visited.
 * @param leaveNode Visitor function that will be called on leaving a node (that is, after all of its children have been
 *     visited).
 * @param leaveNode.node The node that is currently being visited.
 */
export function traverseIssueForest<T extends SchedulableIssue>(
    rootNodes: Iterable<IssueNode<T>>,
    enterNode: (node: IssueNode<T>) => void,
    leaveNode: (node: IssueNode<T>) => void = () => { /* no-op */ }
): void {
  let currentIterator: Iterator<IssueNode<T>> = rootNodes[Symbol.iterator]();
  const stack: [IssueNode<T>, Iterator<IssueNode<T>>][] = [];
  while (true) {
    const iteratorResult = currentIterator.next();
    if (iteratorResult.done) {
      if (stack.length === 0) {
        break;
      }
      let node: IssueNode<T>;
      [node, currentIterator] = stack.pop()!;
      leaveNode(node);
    } else {
      const node: IssueNode<T> = iteratorResult.value;
      enterNode(node);
      if (node.children.length > 0) {
        stack.push([node, currentIterator]);
        currentIterator = node.children[Symbol.iterator]();
      } else {
        leaveNode(node);
      }
    }
  }
}
