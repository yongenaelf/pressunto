import { useMemo, useState } from "react"
import type { ComboBoxProps } from "./ComboBox"
import ComboBox from "./ComboBox"

type LocalComboBoxProps<T> = Pick<
  ComboBoxProps<T>,
  'options' | 'labelKey' | 'valueKey' | 'name' | 'defaultValue'
>

export function ComboBoxLocal<T>(props: LocalComboBoxProps<T>) {
  const [query, setQuery] = useState('')
  const filteredOptions = useMemo(() => {
    return (props.options as T[]).filter(t => (
      query ? (t[props.labelKey] as string || '').includes(query.trim().toLowerCase()) : true
    ))
  }, [query, props.options, props.labelKey])

  return (
    <ComboBox<T>
      name={props.name}
      options={filteredOptions}
      labelKey={props.labelKey}
      valueKey={props.valueKey}
      defaultValue={props.defaultValue}
      onSearch={setQuery}
    />
  )
}