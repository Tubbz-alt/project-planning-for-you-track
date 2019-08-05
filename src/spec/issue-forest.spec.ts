import { IssueNode, makeForest, SchedulableIssue, traverseIssueForest } from '../main';

const issues: SchedulableIssue[] = [
    {id: 'epic', remainingEffortMs: 2},
    {id: 'task-x-b', remainingEffortMs: 3, parent: 'epic'},
    {id: 'task-x-a', remainingEffortMs: 5, parent: 'epic'},
    {id: 'task-x-a-1', remainingEffortMs: 7, parent: 'task-x-a'},
    {id: 'task-y', remainingEffortMs: 11},
];
const rootNodes: Iterable<IssueNode<SchedulableIssue>> = makeForest(issues);

describe('makeForest()', () => {
  test('produces iterable that works multiple times', () => {
    expect(Array.from(rootNodes).map((node) => node.issue)).toEqual([issues[0], issues[4]]);
    expect(Array.from(rootNodes).map((node) => node.issue)).toEqual([issues[0], issues[4]]);
  });

  test('handles empty input', () => {
    expect(Array.from(makeForest([]))).toEqual([]);
  });
});

describe('traverseIssueForest()', () => {
  test(' visits nodes in correct oder', () => {
    const preOrder: string[] = [];
    const postOrder: string[] = [];
    traverseIssueForest(rootNodes, (node) => preOrder.push(node.issue.id), (node) => postOrder.push(node.issue.id));
    expect(preOrder).toEqual(['epic', 'task-x-b', 'task-x-a', 'task-x-a-1', 'task-y']);
    expect(postOrder).toEqual(['task-x-b', 'task-x-a-1', 'task-x-a', 'epic', 'task-y']);
  });
});
