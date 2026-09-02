import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react'
import type { JsonObject, JsonValue } from '../types'

export function isMessages(value: JsonValue[]): value is JsonObject[] {
  return value.length > 0 && value.every(item => typeof item === 'object' && item !== null && !Array.isArray(item) && typeof item.role === 'string' && typeof item.content === 'string')
}

export function MessageEditor({ value, onChange }: { value: JsonObject[]; onChange: (value: JsonValue) => void }) {
  const update = (index: number, patch: JsonObject) => onChange(value.map((message, i) => i === index ? { ...message, ...patch } : message))
  const move = (index: number, direction: number) => { const next = [...value]; const target = index + direction; if (target < 0 || target >= value.length) return; [next[index], next[target]] = [next[target], next[index]]; onChange(next) }
  return <div className="messages-editor">{value.map((message, index) => <div className="message-card" key={index}><div className="message-head"><input list="roles" aria-label={`Message ${index + 1} role`} value={String(message.role)} onChange={e => update(index, { role: e.target.value })}/><div><button aria-label="Move up" onClick={() => move(index, -1)}><ArrowUp/></button><button aria-label="Move down" onClick={() => move(index, 1)}><ArrowDown/></button><button aria-label="Duplicate message" onClick={() => onChange([...value.slice(0,index+1), structuredClone(message), ...value.slice(index+1)])}><Copy/></button><button aria-label="Delete message" onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2/></button></div></div><textarea aria-label={`Message ${index + 1} content`} value={String(message.content)} onChange={e => update(index, { content: e.target.value })} rows={5}/>{Object.keys(message).some(key => !['role','content'].includes(key)) && <details><summary>Advanced fields</summary><pre>{JSON.stringify(Object.fromEntries(Object.entries(message).filter(([key]) => !['role','content'].includes(key))), null, 2)}</pre></details>}</div>)}<button className="secondary" onClick={() => onChange([...value, { role: 'user', content: '' }])}><Plus/> Add message</button><datalist id="roles">{['system','developer','user','assistant','tool'].map(role => <option key={role}>{role}</option>)}</datalist></div>
}
