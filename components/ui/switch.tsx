import type { ComponentProps } from 'react';
type Props = Omit<ComponentProps<'button'>, 'onChange'> & { checked: boolean; onCheckedChange: (checked: boolean) => void };
export function Switch({ checked, onCheckedChange, className = '', ...props }: Props) {
  return <button {...props} type="button" role="switch" aria-checked={checked} data-slot="switch" className={`native-switch ${className}`} onClick={() => onCheckedChange(!checked)}>
    <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
  </button>;
}
