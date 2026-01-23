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
}

const SwitchWithLabel = ({
  label,
  checked,
  onCheckedChange,
  className = '',
  disabled = false,
}: SwitchWithLabelProps & AutomationProps) => {
  return (
    <div className={`switch-with-label ${className}`}>
      <Switch 
        id={label} 
        checked={checked} 
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <Label htmlFor={label} className="switch-label">{label}</Label>
    </div>
  )
}

export { SwitchWithLabel }
