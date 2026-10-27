import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { parseDecimal, weightToKg, displayWeight } from '@/lib/units';

import { NumberCell } from '../NumberCell';

function WeightInLb({ initial, onCommit }: { initial: number | null; onCommit: jest.Mock }) {
  const [kg, setKg] = useState(initial);
  return (
    <>
      <NumberCell
        label="Weight"
        value={kg}
        format={(v) => String(displayWeight(v, 'lb'))}
        parse={(text) => {
          const n = parseDecimal(text);
          return n === null ? null : weightToKg(n, 'lb');
        }}
        onCommit={(v) => {
          onCommit(v);
          setKg(v);
        }}
      />
      <NumberCell
        label="Outside"
        value={null}
        format={String}
        parse={() => 1}
        onCommit={() => setKg(100)}
      />
    </>
  );
}

describe('NumberCell', () => {
  it('keeps the typed text while storing kg', async () => {
    const onCommit = jest.fn();
    await render(<WeightInLb initial={null} onCommit={onCommit} />);
    const input = screen.getByLabelText('Weight');

    await fireEvent.changeText(input, '135');
    expect(onCommit).toHaveBeenLastCalledWith(61.23);
    expect(input).toHaveDisplayValue('135');

    // A half-typed decimal isn't committed and isn't rewritten.
    await fireEvent.changeText(input, '135.');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(input).toHaveDisplayValue('135.');

    await fireEvent(input, 'blur');
    expect(input).toHaveDisplayValue('135');
  });

  it('commits null when cleared', async () => {
    const onCommit = jest.fn();
    await render(<WeightInLb initial={61.23} onCommit={onCommit} />);

    await fireEvent.changeText(screen.getByLabelText('Weight'), ' ');

    expect(onCommit).toHaveBeenLastCalledWith(null);
  });

  it('shows a value changed from outside', async () => {
    await render(<WeightInLb initial={null} onCommit={jest.fn()} />);

    await fireEvent.changeText(screen.getByLabelText('Outside'), 'x');

    expect(screen.getByLabelText('Weight')).toHaveDisplayValue('220.5');
  });
});
