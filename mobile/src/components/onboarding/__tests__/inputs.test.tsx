import { fireEvent, render, screen } from '@testing-library/react-native';

import { BirthDateInput } from '../BirthDateInput';
import { HeightInput } from '../HeightInput';
import { WeightInput } from '../WeightInput';

describe('HeightInput', () => {
  it('reports centimetres directly', async () => {
    const onChange = jest.fn();
    await render(<HeightInput unit="cm" valueCm={null} onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId('height-cm'), '178,5');

    expect(onChange).toHaveBeenLastCalledWith(178.5);
  });

  it('converts feet and inches to centimetres', async () => {
    const onChange = jest.fn();
    await render(<HeightInput unit="in" valueCm={null} onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId('height-feet'), '5');
    expect(onChange).toHaveBeenLastCalledWith(152.4);
    await fireEvent.changeText(screen.getByTestId('height-inches'), '10');

    expect(onChange).toHaveBeenLastCalledWith(177.8);
  });

  it('shows the stored height in feet and inches', async () => {
    await render(<HeightInput unit="in" valueCm={177.8} onChange={jest.fn()} />);

    expect(screen.getByTestId('height-feet').props.value).toBe('5');
    expect(screen.getByTestId('height-inches').props.value).toBe('10');
  });

  it('rejects out-of-range and malformed input', async () => {
    const onChange = jest.fn();
    await render(<HeightInput unit="in" valueCm={null} onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId('height-feet'), '9');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Enter a height between 3′3″ and 8′2″.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('height-feet'), '5');
    await fireEvent.changeText(screen.getByTestId('height-inches'), '13');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('WeightInput', () => {
  it('converts pounds to kilograms', async () => {
    const onChange = jest.fn();
    await render(<WeightInput unit="lb" valueKg={null} onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId('weight'), '160');

    expect(onChange).toHaveBeenLastCalledWith(72.57);
  });

  it('flags weights outside the allowed range', async () => {
    const onChange = jest.fn();
    await render(<WeightInput unit="kg" valueKg={null} onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId('weight'), '400');

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Enter a weight between 25 kg and 350 kg.')).toBeOnTheScreen();
  });

  it('shows a stored weight in the user unit', async () => {
    await render(<WeightInput unit="lb" valueKg={72.57} onChange={jest.fn()} />);

    expect(screen.getByTestId('weight').props.value).toBe('160');
  });
});

describe('BirthDateInput', () => {
  const today = new Date(2026, 9, 25);

  it('reports an ISO date once all fields are valid', async () => {
    const onChange = jest.fn();
    await render(<BirthDateInput value={null} onChange={onChange} today={today} />);

    await fireEvent.changeText(screen.getByTestId('birth-day'), '1');
    await fireEvent.changeText(screen.getByTestId('birth-month'), '3');
    expect(onChange).toHaveBeenLastCalledWith(null);
    await fireEvent.changeText(screen.getByTestId('birth-year'), '1995');

    expect(onChange).toHaveBeenLastCalledWith('1995-03-01');
  });

  it('explains invalid dates', async () => {
    const onChange = jest.fn();
    await render(<BirthDateInput value={null} onChange={onChange} today={today} />);

    await fireEvent.changeText(screen.getByTestId('birth-day'), '30');
    await fireEvent.changeText(screen.getByTestId('birth-month'), '2');
    await fireEvent.changeText(screen.getByTestId('birth-year'), '1995');

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('That date does not exist.')).toBeOnTheScreen();
  });

  it('prefills from a stored date and strips non-digits', async () => {
    const onChange = jest.fn();
    await render(<BirthDateInput value="1995-03-01" onChange={onChange} today={today} />);

    expect(screen.getByTestId('birth-day').props.value).toBe('1');
    await fireEvent.changeText(screen.getByTestId('birth-year'), '19a96');

    expect(screen.getByTestId('birth-year').props.value).toBe('1996');
    expect(onChange).toHaveBeenLastCalledWith('1996-03-01');
  });
});
