'use client';

import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export type SeatBoardChoice = Record<string, { canCreate: boolean }>;

/**
 * The boards an arrangement's technicians may work, and for each one whether they may create tickets
 * there. A board that is not ticked is closed to them. Names only; ids stay in the value.
 */
export default function CoManagedSeatBoardPicker({ idPrefix, boards, value, onChange, disabled }: {
  idPrefix: string;
  boards: Array<{ boardId: string; name: string }>;
  value: SeatBoardChoice;
  onChange: (next: SeatBoardChoice) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('msp/licensing');
  if (boards.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('coManaged.seat.boards.none', { defaultValue: 'There are no boards to choose from.' })}</p>;
  }
  return (
    <ul id={`${idPrefix}-boards`} className="space-y-2">
      {boards.map((board) => {
        const entry = value[board.boardId];
        return (
          <li key={board.boardId} className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox id={`${idPrefix}-board-${board.boardId}`} label={board.name} checked={Boolean(entry)} disabled={disabled}
              onChange={(event) => {
                const next = { ...value };
                if (event.target.checked) next[board.boardId] = { canCreate: false }; else delete next[board.boardId];
                onChange(next);
              }} />
            {entry && (
              <SwitchWithLabel id={`${idPrefix}-board-create-${board.boardId}`} disabled={disabled}
                label={t('coManaged.seat.boards.canCreate', { defaultValue: 'Can create tickets' })}
                checked={entry.canCreate} onCheckedChange={(canCreate) => onChange({ ...value, [board.boardId]: { canCreate } })} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
