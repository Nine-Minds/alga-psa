/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProjectEffortIntegration } from '@alga-psa/projects/context/ProjectEffortIntegrationContext';
import CoManagedProjectEffortProvider from '../../../components/co-managed/CoManagedProjectEffortProvider';

const mocks = vi.hoisted(() => ({ product: vi.fn(), effort: vi.fn() }));
vi.mock('../../../context/ProductContext', () => ({ useProduct: mocks.product }));
vi.mock('../../../components/co-managed/CoManagedEffort', () => ({ default: (props: any) => { mocks.effort(props); return <div>Recorded effort</div>; } }));
function NativeTask({ id }: { id: string }) {
  const integration = useProjectEffortIntegration();
  return <><span>Native task</span>{integration && <integration.TaskEffort taskId={id} />}</>;
}
beforeEach(() => { vi.resetAllMocks(); mocks.product.mockReturnValue({ productCode: 'co_managed', isLoading: false, isMisconfigured: false }); });
afterEach(cleanup);
it.each([{ productCode: 'psa' }, { productCode: 'algadesk' }, { productCode: 'co_managed', isLoading: true }, { productCode: 'co_managed', isMisconfigured: true }])('preserves native content without co-managed effort for %j', product => {
  mocks.product.mockReturnValue(product);
  render(<CoManagedProjectEffortProvider><NativeTask id="task-a" /></CoManagedProjectEffortProvider>);
  expect(screen.getByText('Native task')).toBeInTheDocument(); expect(mocks.effort).not.toHaveBeenCalled();
});
it('injects the current local task identity and removes the slot when the product changes', () => {
  const view = render(<CoManagedProjectEffortProvider><NativeTask id="task-a" /></CoManagedProjectEffortProvider>);
  expect(mocks.effort).toHaveBeenLastCalledWith({ target: { kind: 'local_task', taskId: 'task-a' } });
  view.rerender(<CoManagedProjectEffortProvider><NativeTask id="task-b" /></CoManagedProjectEffortProvider>);
  expect(mocks.effort).toHaveBeenLastCalledWith({ target: { kind: 'local_task', taskId: 'task-b' } });
  mocks.product.mockReturnValue({ productCode: 'psa' });
  view.rerender(<CoManagedProjectEffortProvider><NativeTask id="task-b" /></CoManagedProjectEffortProvider>);
  expect(screen.queryByText('Recorded effort')).toBeNull();
});
