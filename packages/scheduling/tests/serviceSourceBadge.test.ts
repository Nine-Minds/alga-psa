import { describe, expect, it } from 'vitest';
import { resolvePrefilledServiceSource } from '../src/components/time-management/time-entry/time-sheet/serviceSourceBadge';

const prefilled = (source: 'task' | 'phase' | 'project') => ({
  _isServicePrefilled: true,
  _serviceSource: source,
  _originalServiceId: 'svc-1',
  service_id: 'svc-1',
}) as any;

describe('resolvePrefilledServiceSource', () => {
  it('names the level a prefilled service came from', () => {
    expect(resolvePrefilledServiceSource(prefilled('task'))).toBe('task');
    expect(resolvePrefilledServiceSource(prefilled('phase'))).toBe('phase');
    expect(resolvePrefilledServiceSource(prefilled('project'))).toBe('project');
  });

  it('drops the claim once the user overrides the prefilled service', () => {
    expect(
      resolvePrefilledServiceSource({ ...prefilled('phase'), service_id: 'svc-2' })
    ).toBeNull();
  });

  it('claims nothing when the service was not prefilled', () => {
    expect(
      resolvePrefilledServiceSource({ _isServicePrefilled: false, service_id: 'svc-1' } as any)
    ).toBeNull();
  });

  it('claims nothing when the prefill carries no source (e.g. a pre-upgrade entry)', () => {
    expect(
      resolvePrefilledServiceSource({
        _isServicePrefilled: true,
        _originalServiceId: 'svc-1',
        service_id: 'svc-1',
      } as any)
    ).toBeNull();
  });

  it('handles a missing entry', () => {
    expect(resolvePrefilledServiceSource(undefined)).toBeNull();
  });
});
