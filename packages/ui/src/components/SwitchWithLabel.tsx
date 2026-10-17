import React from 'react'
import { Switch } from './Switch'
import { Label } from './Label'
import { AutomationProps } from '../ui-reflection/types'

interface SwitchWithLabelProps {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
  disabled?: boolean
  /** Stable id for the switch; defaults to the label text. */
  id?: string
}

const SwitchWithLabel = ({
  label,
  checked,
  onCheckedChange,
  className = '',
  disabled = false,
  id,
}: SwitchWithLabelProps & AutomationProps) => {
  const switchId = id ?? label
  return (
    <div className={`switch-with-label ${className}`}>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <Label htmlFor={switchId} className="switch-label">{label}</Label>
    </div>
  )
}

export { SwitchWithLabel }
