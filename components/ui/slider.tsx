import type { ComponentProps } from 'react';
type Props = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: number[];
  onValueChange: (value: number) => void;
  onValueCommitted: () => void;
};
export function Slider({ value, onValueChange, onValueCommitted, min = 0, max = 100, className = '', ...props }: Props) {
  const percentage = 100 * (value[0] - Number(min)) / (Number(max) - Number(min));
  return <input {...props} type="range" className={`native-slider ${className}`} min={min} max={max} value={value[0]}
    style={{ background: `linear-gradient(to right, var(--primary) ${percentage}%, var(--muted) ${percentage}%) center / 100% 5px no-repeat` }}
    onChange={event => onValueChange(Number(event.target.value))}
    onPointerUp={onValueCommitted} onPointerCancel={onValueCommitted} onKeyUp={onValueCommitted} onBlur={onValueCommitted} />;
}
