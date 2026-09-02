import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import type { RecordSummary } from '../types'

const symbol: Record<string,string> = { unedited: '○', edited: '●', new: '＋', deleted: '×' }
export function RecordList({ records, selected, onSelect }: { records: RecordSummary[]; selected?: number; onSelect: (id: number) => void }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({ count: records.length, getScrollElement: () => parentRef.current, estimateSize: () => 48, overscan: 8 })
  return <div ref={parentRef} className="record-list"><div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>{virtualizer.getVirtualItems().map(row => { const record = records[row.index]; return <button key={record.id} className={`record-row ${selected === record.id ? 'selected' : ''}`} onClick={() => onSelect(record.id)} style={{ position: 'absolute', transform: `translateY(${row.start}px)`, height: row.size, width: '100%' }}><span className={`status-symbol ${record.status}`}>{record.validationErrors ? '⚠' : symbol[record.status]}</span><strong>{String(record.position).padStart(6,'0')}</strong><span>{record.preview}</span></button> })}</div></div>
}
